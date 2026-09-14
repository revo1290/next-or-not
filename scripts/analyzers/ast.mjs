import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default ?? traverseModule;
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
const PAGE_DATA_EXPORTS = new Map([
  ['getServerSideProps', 'serverSideProps'],
  ['getStaticProps', 'staticProps'],
  ['getStaticPaths', 'staticPaths'],
]);

function lineOf(node) {
  return node?.loc?.start?.line ?? null;
}

function importedName(specifier) {
  if (specifier.type === 'ImportDefaultSpecifier') return 'default';
  if (specifier.type === 'ImportNamespaceSpecifier') return '*';
  return specifier.imported?.name ?? specifier.imported?.value ?? null;
}

function exportedName(specifier) {
  return specifier.exported?.name ?? specifier.exported?.value ?? null;
}

function literalString(node) {
  if (node?.type === 'StringLiteral') return node.value;
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  return null;
}

function isNextModule(value) {
  return value === 'next' || value?.startsWith('next/');
}

function isTrackedModule(value) {
  return isNextModule(value) || value === 'server-only';
}

function unwrapExpression(path) {
  let current = path;
  while (current?.node && [
    'TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression',
    'TypeCastExpression', 'ParenthesizedExpression',
  ].includes(current.node.type)) current = current.get('expression');
  return current;
}

function staticValue(node) {
  if (!node) return { known: false, value: null };
  if (node.type === 'StringLiteral' || node.type === 'BooleanLiteral' || node.type === 'NumericLiteral') {
    return { known: true, value: node.value };
  }
  if (node.type === 'NullLiteral') return { known: true, value: null };
  if (node.type === 'UnaryExpression' && node.operator === '-' && node.argument?.type === 'NumericLiteral') {
    return { known: true, value: -node.argument.value };
  }
  return { known: false, value: null };
}

function propertyName(node) {
  if (!node || node.computed) return null;
  return node.key?.name ?? node.key?.value ?? null;
}

function objectProperty(objectNode, name) {
  if (objectNode?.type !== 'ObjectExpression') return null;
  return objectNode.properties.find((item) =>
    (item.type === 'ObjectProperty' || item.type === 'ObjectMethod') && propertyName(item) === name) ?? null;
}

function resolveObject(path) {
  const target = unwrapExpression(path);
  if (!target?.node) return null;
  if (target.node.type === 'ObjectExpression') return target.node;
  if (target.node.type !== 'Identifier') return null;
  const binding = target.scope.getBinding(target.node.name);
  const bindingPath = binding?.path;
  if (bindingPath?.isVariableDeclarator()) return unwrapExpression(bindingPath.get('init'))?.node ?? null;
  return null;
}

function recordConfigObject(objectNode, flags) {
  if (!objectNode) return;
  const output = staticValue(objectProperty(objectNode, 'output')?.value);
  flags.staticExport ||= output.known && output.value === 'export';
  flags.standaloneOutput ||= output.known && output.value === 'standalone';

  const cacheComponents = staticValue(objectProperty(objectNode, 'cacheComponents')?.value);
  flags.cacheComponents ||= cacheComponents.known && cacheComponents.value === true;
  flags.rewrites ||= Boolean(objectProperty(objectNode, 'rewrites'));
  flags.redirects ||= Boolean(objectProperty(objectNode, 'redirects'));
  flags.headers ||= Boolean(objectProperty(objectNode, 'headers'));
  flags.customWebpack ||= Boolean(objectProperty(objectNode, 'webpack'));

  const images = objectProperty(objectNode, 'images')?.value;
  const loader = staticValue(objectProperty(images, 'loader')?.value);
  flags.customImageLoader ||= (loader.known && loader.value === 'custom') || Boolean(objectProperty(images, 'loaderFile'));
  const unoptimized = staticValue(objectProperty(images, 'unoptimized')?.value);
  flags.imagesUnoptimized ||= unoptimized.known && unoptimized.value === true;

  const experimental = objectProperty(objectNode, 'experimental')?.value;
  flags.experimentalPpr ||= Boolean(objectProperty(objectNode, 'experimental_ppr') || objectProperty(experimental, 'ppr'));
}

function directiveRecords(ast) {
  const records = [];
  traverse(ast, {
    Program(path) {
      for (const item of path.node.directives ?? []) records.push({ value: item.value.value, line: lineOf(item) });
    },
    BlockStatement(path) {
      for (const item of path.node.directives ?? []) records.push({ value: item.value.value, line: lineOf(item) });
    },
  });
  return records;
}

function importRecords(ast) {
  const records = [];
  const unused = [];

  traverse(ast, {
    ImportDeclaration(path) {
      const source = literalString(path.node.source);
      if (!isTrackedModule(source)) return;
      if (path.node.importKind === 'type') {
        unused.push({ module: source, imported: 'type-only', local: null, line: lineOf(path.node), reason: 'type-only' });
        return;
      }
      if (!path.node.specifiers.length) {
        records.push({ module: source, imported: 'side-effect', local: null, line: lineOf(path.node), kind: 'import', used: true });
        return;
      }
      for (const specifier of path.node.specifiers) {
        if (specifier.importKind === 'type') {
          unused.push({ module: source, imported: importedName(specifier), local: specifier.local?.name ?? null, line: lineOf(specifier), reason: 'type-only' });
          continue;
        }
        const local = specifier.local?.name;
        const binding = local ? path.scope.getBinding(local) : null;
        const used = Boolean(binding?.referenced);
        const item = { module: source, imported: importedName(specifier), local: local ?? null, line: lineOf(specifier), kind: 'import', used };
        if (used) records.push(item);
        else unused.push({ ...item, reason: 'unreferenced' });
      }
    },
    ExportNamedDeclaration(path) {
      const source = literalString(path.node.source);
      if (!isTrackedModule(source)) return;
      const specifiers = path.node.specifiers.length ? path.node.specifiers : [null];
      for (const specifier of specifiers) records.push({
        module: source,
        imported: specifier?.local?.name ?? specifier?.local?.value ?? 're-export',
        local: exportedName(specifier),
        line: lineOf(specifier ?? path.node),
        kind: 're-export',
        used: true,
      });
    },
    ExportAllDeclaration(path) {
      const source = literalString(path.node.source);
      if (isTrackedModule(source)) records.push({ module: source, imported: '*', local: '*', line: lineOf(path.node), kind: 're-export', used: true });
    },
    CallExpression(path) {
      let kind = null;
      if (path.node.callee?.type === 'Import') kind = 'dynamic-import';
      else if (path.node.callee?.type === 'Identifier' && path.node.callee.name === 'require' && !path.scope.getBinding('require')) kind = 'require';
      if (!kind) return;
      const source = literalString(path.node.arguments?.[0]);
      if (isTrackedModule(source)) records.push({ module: source, imported: '*', local: null, line: lineOf(path.node), kind, used: true });
    },
    ImportExpression(path) {
      const source = literalString(path.node.source);
      if (isTrackedModule(source)) records.push({ module: source, imported: '*', local: null, line: lineOf(path.node), kind: 'dynamic-import', used: true });
    },
    TSImportEqualsDeclaration(path) {
      const expression = path.node.moduleReference?.expression;
      const source = literalString(expression);
      if (!isTrackedModule(source) || path.node.importKind === 'type') return;
      const local = path.node.id?.name ?? null;
      const binding = local ? path.scope.getBinding(local) : null;
      if (binding?.referenced) records.push({ module: source, imported: '*', local, line: lineOf(path.node), kind: 'import-equals', used: true });
      else unused.push({ module: source, imported: '*', local, line: lineOf(path.node), kind: 'import-equals', used: false, reason: 'unreferenced' });
    },
  });
  return { records, unused };
}

function exportedBindingNames(ast) {
  const names = new Map();
  traverse(ast, {
    ExportNamedDeclaration(path) {
      const declaration = path.node.declaration;
      if (declaration?.type === 'FunctionDeclaration' || declaration?.type === 'ClassDeclaration') {
        if (declaration.id?.name) names.set(declaration.id.name, { exported: declaration.id.name, path: path.get('declaration') });
      } else if (declaration?.type === 'VariableDeclaration') {
        for (const declaratorPath of path.get('declaration.declarations')) {
          if (declaratorPath.node.id?.type === 'Identifier') names.set(declaratorPath.node.id.name, { exported: declaratorPath.node.id.name, path: declaratorPath });
        }
      }
      for (const specifierPath of path.get('specifiers')) {
        const local = specifierPath.node.local?.name ?? specifierPath.node.local?.value;
        const exported = exportedName(specifierPath.node);
        if (local && exported) names.set(local, { exported, path: specifierPath });
      }
    },
  });
  return names;
}

function bindingDeclarationPath(exportRecord) {
  let candidate = exportRecord.path;
  if (candidate?.isExportSpecifier()) {
    const local = candidate.node.local?.name;
    candidate = local ? candidate.scope.getBinding(local)?.path : null;
  }
  if (candidate?.isVariableDeclarator()) return unwrapExpression(candidate.get('init'));
  return candidate;
}

function requestParameterUsed(functionPath) {
  if (!functionPath?.node || !(functionPath.isFunction?.() || functionPath.isObjectMethod?.())) return false;
  let paramPath = functionPath.get('params')?.[0];
  if (!paramPath?.node) return false;
  if (paramPath.isAssignmentPattern()) paramPath = paramPath.get('left');
  if (!paramPath.isIdentifier()) return false;
  const binding = functionPath.scope.getBinding(paramPath.node.name);
  return Boolean(binding?.referenced);
}

function exportedFeatures(ast) {
  const exported = exportedBindingNames(ast);
  const features = [];
  const handlers = [];
  for (const [local, record] of exported) {
    const name = record.exported;
    const declarationPath = bindingDeclarationPath(record);
    const line = lineOf(record.path.node);
    if (HTTP_METHODS.has(name)) {
      handlers.push({ name, line, reExport: Boolean(record.path.isExportSpecifier?.() && !declarationPath) });
      if (requestParameterUsed(declarationPath)) features.push({ name: 'requestDependentRouteHandlers', line });
    }
    if (PAGE_DATA_EXPORTS.has(name)) features.push({ name: PAGE_DATA_EXPORTS.get(name), line });
    if (name === 'generateStaticParams') features.push({ name: 'staticParams', line });
    if (name === 'generateMetadata' || name === 'metadata') features.push({ name: 'metadataApis', line });
    if (name === 'runtime') features.push({ name: 'routeRuntimeConfig', line });
    if (name === 'revalidate') features.push({ name: 'routeRevalidation', line });
    if (name === 'dynamicParams') {
      const target = declarationPath?.isVariableDeclarator?.() ? unwrapExpression(declarationPath.get('init')) : declarationPath;
      if (staticValue(target?.node).value === true) features.push({ name: 'dynamicParamsEnabled', line });
    }
  }
  return { features, handlers };
}

function initialPropsLines(ast) {
  const lines = [];
  traverse(ast, {
    AssignmentExpression(path) {
      const left = path.node.left;
      if (left?.type === 'MemberExpression' && !left.computed && left.property?.name === 'getInitialProps') lines.push(lineOf(path.node));
      if (left?.type === 'Identifier' && left.name === 'getInitialProps') lines.push(lineOf(path.node));
    },
    ClassMethod(path) {
      if (path.node.static && propertyName(path.node) === 'getInitialProps') lines.push(lineOf(path.node));
    },
  });
  return lines;
}

function configFromAst(ast) {
  const flags = {
    staticExport: false, standaloneOutput: false, cacheComponents: false,
    customImageLoader: false, imagesUnoptimized: false, rewrites: false,
    redirects: false, headers: false, customWebpack: false, experimentalPpr: false,
  };
  traverse(ast, {
    ExportDefaultDeclaration(path) {
      recordConfigObject(resolveObject(path.get('declaration')), flags);
    },
    AssignmentExpression(path) {
      const left = path.node.left;
      if (left?.type === 'MemberExpression' && !left.computed && left.object?.name === 'module' && left.property?.name === 'exports') {
        recordConfigObject(resolveObject(path.get('right')), flags);
      }
    },
  });
  return flags;
}

export function parseSource(text, filename) {
  return parse(text, {
    sourceType: 'unambiguous',
    sourceFilename: filename,
    allowAwaitOutsideFunction: true,
    allowReturnOutsideFunction: true,
    createImportExpressions: true,
    plugins: [
      'typescript', 'jsx', 'decorators-legacy', 'importAttributes',
      'explicitResourceManagement', 'topLevelAwait',
    ],
  });
}

export function analyzeSourceAst(text, filename) {
  const ast = parseSource(text, filename);
  const imports = importRecords(ast);
  const exported = exportedFeatures(ast);
  return {
    ok: true,
    detectionMethod: 'ast',
    imports: imports.records,
    unusedImports: imports.unused,
    directives: directiveRecords(ast),
    exportedFeatures: exported.features,
    routeHandlers: exported.handlers,
    initialProps: initialPropsLines(ast),
    config: configFromAst(ast),
  };
}

export function analyzeSourceFallback(text) {
  const imports = [];
  const pattern = /^\s*(?:import|export)\s+(?:[^'";]+?\s+from\s+)?['"](next(?:\/[^'"]*)?)['"]/gm;
  for (const match of text.matchAll(pattern)) {
    imports.push({ module: match[1], imported: 'unknown', local: null, line: text.slice(0, match.index).split('\n').length, kind: 'fallback-import', used: true });
  }
  return {
    ok: false,
    detectionMethod: 'regex-fallback',
    imports,
    unusedImports: [],
    directives: [],
    exportedFeatures: [],
    routeHandlers: [],
    initialProps: [],
    config: {},
  };
}

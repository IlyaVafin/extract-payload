import fs from 'fs';
export function parseSDUI(rawData: string) {
  const lines = rawData.trim().split(/\n(?=[0-9a-f]+:)/i);

  const registry: Record<string, any> = {};

  // ---------------------------
  // Registry build
  // ---------------------------

  for (const line of lines) {
    const idx = line.indexOf(':');

    if (idx === -1) continue;

    const id = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();

    try {
      if (value.startsWith('I[')) {
        const [moduleId, chunks, exportName] = JSON.parse(value.substring(1));

        registry[id] = {
          $$typeof: 'client.reference',
          moduleId,
          chunks,
          exportName,
        };

        continue;
      }

      if (value.startsWith('T')) {
        registry[id] = value.replace(/^T\d+,/, '');
        continue;
      }

      if (value === '"$Sreact.fragment"') {
        registry[id] = 'React.Fragment';
        continue;
      }

      registry[id] = JSON.parse(value);
    } catch {
      registry[id] = value;
    }
  }

  // ---------------------------
  // Helpers
  // ---------------------------

  const cache = new Map<string, any>();

  function isReactElement(node: any) {
    return Array.isArray(node) && node.length >= 4 && node[0] === '$';
  }

  function getByPath(root: any, path: string[]) {
    let current = root;

    for (const segment of path) {
      if (current == null) return undefined;

      if (/^\d+$/.test(segment)) {
        current = current[Number(segment)];
      } else {
        current = current[segment];
      }
    }

    return current;
  }

  // ---------------------------
  // Resolve
  // ---------------------------

  function resolve(node: any, stack = new Set<string>()): any {
    // undefined
    if (node === '$undefined') {
      return undefined;
    }

    // null
    if (node == null) {
      return node;
    }

    // string refs
    if (typeof node === 'string') {
      // $L13
      if (node.startsWith('$L')) {
        const refId = node.slice(2);

        if (cache.has(refId)) {
          return cache.get(refId);
        }

        if (stack.has(refId)) {
          return `[Circular:${refId}]`;
        }

        if (!(refId in registry)) {
          return node;
        }

        stack.add(refId);

        const result = resolve(registry[refId], stack);

        stack.delete(refId);

        cache.set(refId, result);

        return result;
      }

      // $13:props:children:0
      if (
        node.startsWith('$') &&
        !node.startsWith('$L') &&
        !node.startsWith('$S')
      ) {
        const path = node.slice(1).split(':');

        const rootId = path.shift();

        if (rootId && registry[rootId]) {
          const target = getByPath(registry[rootId], path);

          if (target !== undefined) {
            return resolve(target, stack);
          }
        }
      }

      return node;
    }

    // React Flight element
    if (isReactElement(node)) {
      return {
        $$typeof: 'react.element',

        type: resolve(node[1], stack),

        key: node[2],

        props: resolve(node[3], stack),
      };
    }

    // array
    if (Array.isArray(node)) {
      return node.map((item) => resolve(item, stack));
    }

    // object
    if (typeof node === 'object') {
      const result: Record<string, any> = {};

      for (const [key, value] of Object.entries(node)) {
        result[key] = resolve(value, stack);
      }

      return result;
    }

    return node;
  }

  return resolve(registry['0']);
}

const content = fs.readFileSync('./exp.json', { encoding: 'utf-8' });

const result = parseSDUI(content);
fs.writeFileSync('./res.json', JSON.stringify(result, null, 2));

// Flags wall-clock reads in tests (R-QA-022). Time comes from the Clock interface: clock.now().
// Flagged: Date.now(), new Date() with no arguments, performance.now().

function isMember(node, objectName, propertyName) {
  if (node.type !== 'MemberExpression') return false;
  if (node.object.type !== 'Identifier' || node.object.name !== objectName) return false;
  if (!node.computed)
    return node.property.type === 'Identifier' && node.property.name === propertyName;
  return node.property.type === 'Literal' && node.property.value === propertyName;
}

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow reading the wall clock in tests; use clock.now()' },
    schema: [],
    messages: {
      realTime:
        'Do not read the wall clock in tests ({{ what }}); use clock.now() from the Clock interface.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (isMember(node.callee, 'Date', 'now')) {
          context.report({ node, messageId: 'realTime', data: { what: 'Date.now()' } });
        } else if (isMember(node.callee, 'performance', 'now')) {
          context.report({ node, messageId: 'realTime', data: { what: 'performance.now()' } });
        }
      },
      NewExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'Date' &&
          node.arguments.length === 0
        ) {
          context.report({ node, messageId: 'realTime', data: { what: 'new Date()' } });
        }
      },
    };
  },
};

export default rule;

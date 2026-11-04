// Flags Math.random() in tests (R-QA-022). Randomness comes from the seeded PRNG exported by
// @gavel/shared/testing.

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow Math.random in tests; use the seeded PRNG' },
    schema: [],
    messages: {
      random: 'Do not use Math.random in tests; use the seeded PRNG from @gavel/shared/testing.',
    },
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (node.object.type !== 'Identifier' || node.object.name !== 'Math') return;
        const name = node.computed
          ? node.property.type === 'Literal'
            ? node.property.value
            : undefined
          : node.property.type === 'Identifier'
            ? node.property.name
            : undefined;
        if (name === 'random') context.report({ node, messageId: 'random' });
      },
    };
  },
};

export default rule;

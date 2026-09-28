'use strict';

function matches(index, fields, options) {
  return Boolean(index.unique) === Boolean(options.unique)
    && Array.isArray(index.fields)
    && index.fields.length === fields.length
    && index.fields.every((field, position) => field.attribute === fields[position]
      && !field.length && (!field.order || field.order.toUpperCase() === 'ASC'));
}

// MySQL/MariaDB DDL commits before SequelizeMeta is updated. An interrupted
// migration must accept its completed indexes without dropping or rebuilding them.
async function ensureIndex(queryInterface, table, fields, options) {
  const inspect = async () => {
    const index = (await queryInterface.showIndex(table)).find(row => row.name === options.name);
    if (!index) return false;
    if (!matches(index, fields, options)) {
      throw new Error(`Schema index conflict: ${table}.${options.name}. Expected ${options.unique ? 'unique ' : ''}index (${fields.join(', ')}). Existing definition was not changed.`);
    }
    return true;
  };
  if (await inspect()) return;
  try {
    await queryInterface.addIndex(table, fields, options);
  } catch (error) {
    // A concurrent migration may have completed the same index after inspection.
    const code = error.original?.code || error.parent?.code || error.code;
    if (code === 'ER_DUP_KEYNAME' && await inspect()) return;
    throw error;
  }
}
module.exports = { ensureIndex };

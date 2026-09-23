const { DataTypes } = require('sequelize');

// mysql2 returns MariaDB JSON/LONGTEXT values as strings. Hydrate them at the
// model boundary so both business logic and API serialization see objects.
function jsonObjectAttribute(attribute) {
  return { type: DataTypes.JSON, allowNull: true, get() {
    const stored = this.getDataValue(attribute);
    if (stored === undefined || stored === null) return stored;
    const value = typeof stored === 'string' ? JSON.parse(stored) : stored;
    if (value === null) return null;
    if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid JSON object: ${attribute}`);
    return value;
  } };
}
module.exports = { jsonObjectAttribute };

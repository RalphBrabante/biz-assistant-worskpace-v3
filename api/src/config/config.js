const env = process.env.NODE_ENV || 'development';

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const normalized = String(value).trim().toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

function buildDialectOptions() {
  const connectTimeout = Number(process.env.DB_CONNECT_TIMEOUT_MS || 20000);
  const sslEnabled = parseBoolean(process.env.DB_SSL, false);
  const rejectUnauthorized = parseBoolean(
    process.env.DB_SSL_REJECT_UNAUTHORIZED,
    true
  );

  const dialectOptions = {
    connectTimeout,
  };

  if (sslEnabled) {
    dialectOptions.ssl = {
      require: true,
      rejectUnauthorized,
    };
  }

  return dialectOptions;
}

const base = {
  username: process.env.DB_USER || 'appuser',
  password: process.env.DB_PASSWORD || 'apppassword',
  database: process.env.DB_NAME || 'appdb',
  host: process.env.DB_HOST || 'mysql',
  port: Number(process.env.DB_PORT || 3306),
  dialect: 'mysql',
  logging: false,
  dialectOptions: buildDialectOptions(),
  pool: {
    max: Number(process.env.DB_POOL_MAX || 4),
    min: Number(process.env.DB_POOL_MIN || 0),
    acquire: Number(process.env.DB_POOL_ACQUIRE_MS || 20000),
    idle: Number(process.env.DB_POOL_IDLE_MS || 5000),
    evict: Number(process.env.DB_POOL_EVICT_MS || 1000),
  },
};

module.exports = {
  env,
  development: {
    ...base,
    logging: parseBoolean(process.env.DB_LOG_SQL, false),
  },
  test: {
    ...base,
    logging: false,
  },
  production: {
    ...base,
    logging: parseBoolean(process.env.DB_LOG_SQL, false),
    dialectOptions: buildDialectOptions(),
    pool: {
      max: Number(process.env.DB_POOL_MAX || 4),
      min: Number(process.env.DB_POOL_MIN || 0),
      acquire: Number(process.env.DB_POOL_ACQUIRE_MS || 20000),
      idle: Number(process.env.DB_POOL_IDLE_MS || 5000),
      evict: Number(process.env.DB_POOL_EVICT_MS || 1000),
    },
  },
};

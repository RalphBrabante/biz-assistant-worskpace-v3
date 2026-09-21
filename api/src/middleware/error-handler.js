const {
  ValidationError,
  UniqueConstraintError,
  ForeignKeyConstraintError,
  DatabaseError,
} = require('sequelize');
const { MulterError } = require('multer');
const { AppError } = require('../utils/app-error');

function statusToCode(status) {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 422:
      return 'VALIDATION_ERROR';
    case 500:
      return 'INTERNAL_SERVER_ERROR';
    default:
      return 'ERROR';
  }
}

function formatSequelizeError(err) {
  if (err instanceof UniqueConstraintError) {
    return {
      status: 409,
      code: 'UNIQUE_CONSTRAINT_ERROR',
      message:
        err.errors && err.errors.length > 0
          ? err.errors[0].message
          : 'Duplicate value violates unique constraint.',
    };
  }

  if (err instanceof ValidationError) {
    const firstMessage =
      err.errors && err.errors.length > 0
        ? err.errors[0].message
        : 'Validation failed.';
    return {
      status: 422,
      code: 'VALIDATION_ERROR',
      message: firstMessage,
    };
  }

  if (err instanceof ForeignKeyConstraintError) {
    return {
      status: 409,
      code: 'FOREIGN_KEY_CONSTRAINT_ERROR',
      message: 'Cannot complete operation due to related records.',
    };
  }

  if (err instanceof DatabaseError) {
    const sqlMessage = String(err?.parent?.sqlMessage || err?.message || '').trim();
    if (/unknown column/i.test(sqlMessage)) {
      return {
        status: 500,
        code: 'DATABASE_SCHEMA_OUTDATED',
        message: 'Database schema is outdated. Run the latest migrations and try again.',
      };
    }

    if (/data truncated for column .*category/i.test(sqlMessage)) {
      return {
        status: 400,
        code: 'BAD_REQUEST',
        message: 'category must be one of: goods, operations, others.',
      };
    }

    return {
      status: 500,
      code: 'DATABASE_ERROR',
      message: 'A database error occurred.',
    };
  }

  return null;
}

function successCodeFromStatus(status) {
  switch (status) {
    case 200:
      return 'SUCCESS';
    case 201:
      return 'CREATED';
    case 202:
      return 'ACCEPTED';
    case 204:
      return 'NO_CONTENT';
    default:
      return 'SUCCESS';
  }
}

function errorResponseShapeMiddleware(req, res, next) {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    if (res.statusCode >= 400) {
      if (body && typeof body === 'object' && body.code && body.message) {
        const errorResponse = { code: body.code, message: body.message };
        if (Object.prototype.hasOwnProperty.call(body, 'data')) {
          errorResponse.data = body.data;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'meta')) {
          errorResponse.meta = body.meta;
        }
        return originalJson(errorResponse);
      }

      const code = statusToCode(res.statusCode);
      let message = 'Request failed.';
      let data;
      let meta;

      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        if (typeof body.message === 'string') {
          message = body.message;
        } else if (body.error && typeof body.error.message === 'string') {
          message = body.error.message;
        }

        if (Object.prototype.hasOwnProperty.call(body, 'data')) {
          data = body.data;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'meta')) {
          meta = body.meta;
        }
      }

      const errorResponse = { code, message };
      if (data !== undefined) {
        errorResponse.data = data;
      }
      if (meta !== undefined) {
        errorResponse.meta = meta;
      }

      return originalJson(errorResponse);
    }

    if (body && typeof body === 'object' && body.code && body.message) {
      return originalJson(body);
    }

    const code = successCodeFromStatus(res.statusCode);
    const message =
      body && typeof body === 'object' && typeof body.message === 'string'
        ? body.message
        : 'Request successful.';

    const response = { code, message };

    if (body && typeof body === 'object') {
      if (Object.prototype.hasOwnProperty.call(body, 'data')) {
        response.data = body.data;
      } else if (!Object.prototype.hasOwnProperty.call(body, 'ok')) {
        response.data = body;
      }

      if (Object.prototype.hasOwnProperty.call(body, 'meta')) {
        response.meta = body.meta;
      }
    }

    return originalJson(response);
  };

  next();
}

function notFoundHandler(req, res) {
  return res.status(404).json({
    code: 'NOT_FOUND',
    message: 'Endpoint not found.',
  });
}

function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  if (err instanceof AppError) {
    return res.status(err.status).json({
      code: err.code,
      message: err.message,
    });
  }

  if (err instanceof MulterError) {
    const isSizeError = err.code === 'LIMIT_FILE_SIZE';
    return res.status(400).json({
      code: 'BAD_REQUEST',
      message: isSizeError
        ? 'Uploaded file is too large. Maximum file size is 10MB.'
        : 'Invalid file upload request.',
    });
  }

  if (err && typeof err.message === 'string' && err.message.includes('Only image files are allowed')) {
    return res.status(400).json({
      code: 'BAD_REQUEST',
      message: err.message,
    });
  }

  const sequelizeError = formatSequelizeError(err);
  if (sequelizeError) {
    return res.status(sequelizeError.status).json({
      code: sequelizeError.code,
      message: sequelizeError.message,
    });
  }

  console.error('Unhandled API error:', err);

  return res.status(500).json({
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Unexpected server error.',
  });
}

module.exports = {
  errorResponseShapeMiddleware,
  notFoundHandler,
  errorHandler,
};

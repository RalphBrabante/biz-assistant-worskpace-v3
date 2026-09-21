class AppError extends Error {
  constructor(code, message, status = 500, details = null) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

module.exports = {
  AppError,
};

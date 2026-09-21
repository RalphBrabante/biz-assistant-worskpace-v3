const fs = require('fs');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getModels } = require('../sequelize');

function isDevEnvironment() {
  const env = String(process.env.NODE_ENV || 'development').toLowerCase().trim();
  return env === 'development' || env === 'dev' || env === '';
}

function logStorageDev(level, message, details = undefined) {
  if (!isDevEnvironment()) {
    return;
  }
  const payload = details ? ` ${JSON.stringify(details)}` : '';
  const line = `[storage-dev] ${message}${payload}`;
  if (level === 'error') {
    console.error(line);
    return;
  }
  if (level === 'warn') {
    console.warn(line);
    return;
  }
  console.log(line);
}

const STORAGE_KEYS = {
  provider: 'storage_provider',
  expenseAttachmentProvider: 'storage_provider_expense_attachment',
  profileImageProvider: 'storage_provider_profile_image',
  endpoint: 'do_spaces_endpoint',
  region: 'do_spaces_region',
  bucket: 'do_spaces_bucket',
  accessKey: 'do_spaces_access_key',
  secretKey: 'do_spaces_secret_key',
  cdnBaseUrl: 'do_spaces_cdn_base_url',
  directory: 'do_spaces_directory',
  googleDriveClientId: 'google_drive_client_id',
  googleDriveClientSecret: 'google_drive_client_secret',
  googleDriveRedirectUri: 'google_drive_redirect_uri',
  googleDriveFolderId: 'google_drive_folder_id',
  googleDriveAccessToken: 'google_drive_access_token',
  googleDriveRefreshToken: 'google_drive_refresh_token',
  googleDriveTokenType: 'google_drive_token_type',
  googleDriveExpiryDate: 'google_drive_expiry_date',
  googleDriveScope: 'google_drive_scope',
  googleDriveAccountEmail: 'google_drive_account_email',
  googleDriveOauthState: 'google_drive_oauth_state',
};

function normalizeProvider(value) {
  const provider = String(value || 'local').trim().toLowerCase();
  return ['do_spaces', 'google_drive'].includes(provider) ? provider : 'local';
}

function normalizeTargetProvider(value, fallback = 'local') {
  const provider = String(value || '').trim().toLowerCase();
  if (['local', 'do_spaces', 'google_drive'].includes(provider)) {
    return provider;
  }
  return normalizeProvider(fallback);
}

function trimOrEmpty(value) {
  return String(value || '').trim();
}

function encodeObjectKey(key) {
  return String(key || '')
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

async function getRawStorageSettings() {
  const models = getModels();
  if (!models || !models.AppSetting) {
    return {};
  }

  const rows = await models.AppSetting.findAll({
    where: {
      key: Object.values(STORAGE_KEYS),
    },
    attributes: ['key', 'valueText'],
  });

  const map = {};
  for (const row of rows) {
    map[row.key] = String(row.valueText || '');
  }
  return map;
}

async function getStorageConfig() {
  const settings = await getRawStorageSettings();
  const provider = normalizeProvider(settings[STORAGE_KEYS.provider]);
  const uploadTargets = {
    expenseAttachment: normalizeTargetProvider(
      settings[STORAGE_KEYS.expenseAttachmentProvider],
      provider
    ),
    profileImage: normalizeTargetProvider(
      settings[STORAGE_KEYS.profileImageProvider],
      provider
    ),
  };

  const doSpaces = {
    endpoint: trimOrEmpty(settings[STORAGE_KEYS.endpoint]),
    region: trimOrEmpty(settings[STORAGE_KEYS.region]),
    bucket: trimOrEmpty(settings[STORAGE_KEYS.bucket]),
    accessKey: trimOrEmpty(settings[STORAGE_KEYS.accessKey]),
    secretKey: trimOrEmpty(settings[STORAGE_KEYS.secretKey]),
    cdnBaseUrl: trimOrEmpty(settings[STORAGE_KEYS.cdnBaseUrl]),
    directory: trimOrEmpty(settings[STORAGE_KEYS.directory]),
  };

  const isDoSpacesConfigured = Boolean(
    doSpaces.endpoint &&
      doSpaces.region &&
      doSpaces.bucket &&
      doSpaces.accessKey &&
      doSpaces.secretKey
  );

  const googleDrive = {
    clientId:
      trimOrEmpty(settings[STORAGE_KEYS.googleDriveClientId]) ||
      trimOrEmpty(process.env.GOOGLE_DRIVE_CLIENT_ID),
    clientSecret:
      trimOrEmpty(settings[STORAGE_KEYS.googleDriveClientSecret]) ||
      trimOrEmpty(process.env.GOOGLE_DRIVE_CLIENT_SECRET),
    redirectUri:
      trimOrEmpty(settings[STORAGE_KEYS.googleDriveRedirectUri]) ||
      trimOrEmpty(process.env.GOOGLE_DRIVE_REDIRECT_URI) ||
      `${String(process.env.APP_BASE_URL || 'http://localhost').trim().replace(/\/+$/, '')}/api/v1/settings/storage/google-drive/callback`,
    folderId:
      trimOrEmpty(settings[STORAGE_KEYS.googleDriveFolderId]) ||
      trimOrEmpty(process.env.GOOGLE_DRIVE_FOLDER_ID),
    accessToken: trimOrEmpty(settings[STORAGE_KEYS.googleDriveAccessToken]),
    refreshToken: trimOrEmpty(settings[STORAGE_KEYS.googleDriveRefreshToken]),
    tokenType: trimOrEmpty(settings[STORAGE_KEYS.googleDriveTokenType]) || 'Bearer',
    expiryDate: trimOrEmpty(settings[STORAGE_KEYS.googleDriveExpiryDate]),
    scope: trimOrEmpty(settings[STORAGE_KEYS.googleDriveScope]),
    accountEmail: trimOrEmpty(settings[STORAGE_KEYS.googleDriveAccountEmail]),
    oauthState: trimOrEmpty(settings[STORAGE_KEYS.googleDriveOauthState]),
  };

  const isGoogleDriveConfigured = Boolean(
    googleDrive.clientId && googleDrive.clientSecret && googleDrive.refreshToken
  );

  return {
    provider,
    uploadTargets,
    doSpaces,
    isDoSpacesConfigured,
    googleDrive,
    isGoogleDriveConfigured,
  };
}

function resolveUploadProvider(config, targetKey = '') {
  const key = String(targetKey || '').trim();
  if (key === 'expense_attachment') {
    return normalizeTargetProvider(config.uploadTargets?.expenseAttachment, config.provider);
  }
  if (key === 'profile_image') {
    return normalizeTargetProvider(config.uploadTargets?.profileImage, config.provider);
  }
  return normalizeProvider(config.provider);
}

function normalizeEndpoint(endpoint) {
  const value = trimOrEmpty(endpoint);
  if (!value) {
    return '';
  }
  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }
  return `https://${value}`;
}

function toEndpointHost(endpoint) {
  const normalized = normalizeEndpoint(endpoint);
  if (!normalized) {
    return '';
  }
  try {
    return new URL(normalized).host || '';
  } catch (_err) {
    return '';
  }
}

function normalizeDoSpacesEndpoint(endpoint, bucket) {
  const host = toEndpointHost(endpoint);
  const bucketName = trimOrEmpty(bucket);
  if (!host) {
    return normalizeEndpoint(endpoint);
  }

  // If user entered bucket-prefixed endpoint (e.g. mybucket.sgp1.digitaloceanspaces.com),
  // normalize it to region endpoint (e.g. sgp1.digitaloceanspaces.com) to avoid
  // TLS SAN mismatch and duplicate bucket host generation.
  if (bucketName && host.toLowerCase().startsWith(`${bucketName.toLowerCase()}.`)) {
    const strippedHost = host.slice(bucketName.length + 1);
    return `https://${strippedHost}`;
  }

  return normalizeEndpoint(endpoint);
}

function buildPublicUrl(config, key) {
  const encodedKey = encodeObjectKey(key);
  const cdnBaseUrl = trimOrEmpty(config.cdnBaseUrl);
  if (cdnBaseUrl) {
    return `${cdnBaseUrl.replace(/\/+$/, '')}/${encodedKey}`;
  }

  const endpointUrl = new URL(normalizeDoSpacesEndpoint(config.endpoint, config.bucket));
  const protocol = endpointUrl.protocol || 'https:';
  const host = endpointUrl.host;
  const bucket = trimOrEmpty(config.bucket);
  const bucketHost = host.startsWith(`${bucket}.`) ? host : `${bucket}.${host}`;
  return `${protocol}//${bucketHost}/${encodedKey}`;
}

function buildObjectKey(config, folder, fileName) {
  const baseDir = trimOrEmpty(config.directory).replace(/^\/+|\/+$/g, '');
  const normalizedFolder = trimOrEmpty(folder).replace(/^\/+|\/+$/g, '');
  const normalizedFileName = trimOrEmpty(fileName).replace(/^\/+|\/+$/g, '');
  const parts = [baseDir, normalizedFolder, normalizedFileName].filter(Boolean);
  return parts.join('/');
}

function decodeObjectKey(key) {
  return String(key || '')
    .split('/')
    .filter(Boolean)
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch (_err) {
        return part;
      }
    })
    .join('/');
}

class StorageProviderError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'StorageProviderError';
    this.code = code || 'STORAGE_ERROR';
    this.details = details;
  }
}

function describeStorageError(err) {
  const name = String(err?.name || '').trim();
  const message = String(err?.message || '').trim();
  const statusCode = Number(err?.$metadata?.httpStatusCode || 0);

  if (name === 'CredentialsProviderError' || message.toLowerCase().includes('credential')) {
    return 'Bucket credentials are invalid or missing.';
  }
  if (name === 'TimeoutError' || message.toLowerCase().includes('timeout')) {
    return 'Connection to DigitalOcean Spaces timed out.';
  }
  if (statusCode === 403 || name === 'AccessDenied') {
    return 'Access denied by DigitalOcean Spaces. Check access key, secret key, and bucket policy.';
  }
  if (statusCode === 404 || name === 'NoSuchBucket') {
    return 'DigitalOcean Spaces bucket was not found.';
  }
  if (statusCode === 400 || name === 'InvalidAccessKeyId' || name === 'SignatureDoesNotMatch') {
    return 'Invalid DigitalOcean Spaces credentials or endpoint configuration.';
  }

  return message || 'DigitalOcean Spaces upload failed.';
}

function buildGoogleDrivePublicUrl(fileId) {
  const id = trimOrEmpty(fileId);
  if (!id) {
    return '';
  }
  return `https://drive.google.com/uc?id=${encodeURIComponent(id)}`;
}

function extractGoogleDriveFileId(fileUrl) {
  const raw = trimOrEmpty(fileUrl);
  if (!raw) {
    return '';
  }
  try {
    const parsed = new URL(raw);
    if (parsed.hostname === 'drive.google.com') {
      const directId = parsed.searchParams.get('id');
      if (directId) {
        return directId;
      }
      const pathMatch = parsed.pathname.match(/\/file\/d\/([^/]+)/i);
      if (pathMatch?.[1]) {
        return pathMatch[1];
      }
    }
  } catch (_err) {
    return '';
  }
  return '';
}

async function fetchGoogleOauthToken({ clientId, clientSecret, redirectUri, code, refreshToken }) {
  const params = new URLSearchParams();
  params.set('client_id', clientId);
  params.set('client_secret', clientSecret);
  if (code) {
    params.set('code', code);
    params.set('grant_type', 'authorization_code');
    params.set('redirect_uri', redirectUri);
  } else {
    params.set('refresh_token', refreshToken);
    params.set('grant_type', 'refresh_token');
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new StorageProviderError(
      'GOOGLE_DRIVE_OAUTH_ERROR',
      String(data?.error_description || data?.error || 'Google OAuth token request failed.')
    );
  }
  return data;
}

async function refreshGoogleDriveAccessToken(config) {
  if (!config.googleDrive.refreshToken) {
    throw new StorageProviderError(
      'GOOGLE_DRIVE_NOT_CONNECTED',
      'Google Drive is not connected. Complete OAuth connection first.'
    );
  }
  const tokenData = await fetchGoogleOauthToken({
    clientId: config.googleDrive.clientId,
    clientSecret: config.googleDrive.clientSecret,
    refreshToken: config.googleDrive.refreshToken,
  });

  const accessToken = trimOrEmpty(tokenData.access_token);
  if (!accessToken) {
    throw new StorageProviderError(
      'GOOGLE_DRIVE_OAUTH_ERROR',
      'Google OAuth did not return an access token.'
    );
  }

  const expiresIn = Number(tokenData.expires_in || 0);
  const expiryDate = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : '';
  const models = getModels();
  if (models?.AppSetting) {
    await models.AppSetting.upsert({
      key: STORAGE_KEYS.googleDriveAccessToken,
      valueText: accessToken,
      updatedBy: null,
    });
    await models.AppSetting.upsert({
      key: STORAGE_KEYS.googleDriveTokenType,
      valueText: trimOrEmpty(tokenData.token_type) || 'Bearer',
      updatedBy: null,
    });
    await models.AppSetting.upsert({
      key: STORAGE_KEYS.googleDriveExpiryDate,
      valueText: expiryDate,
      updatedBy: null,
    });
    await models.AppSetting.upsert({
      key: STORAGE_KEYS.googleDriveScope,
      valueText: trimOrEmpty(tokenData.scope),
      updatedBy: null,
    });
  }

  return {
    accessToken,
    tokenType: trimOrEmpty(tokenData.token_type) || 'Bearer',
    expiryDate,
  };
}

async function getGoogleDriveAuthorizationHeader(config) {
  const now = Date.now();
  const expiry = Date.parse(trimOrEmpty(config.googleDrive.expiryDate) || '');
  if (config.googleDrive.accessToken && Number.isFinite(expiry) && expiry > now + 30 * 1000) {
    return `${config.googleDrive.tokenType || 'Bearer'} ${config.googleDrive.accessToken}`;
  }
  const refreshed = await refreshGoogleDriveAccessToken(config);
  return `${refreshed.tokenType || 'Bearer'} ${refreshed.accessToken}`;
}

async function ensureGoogleDrivePublicReadable(fileId, authHeader) {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true`,
    {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone',
      }),
    }
  );
  if (response.ok || response.status === 409) {
    return { ok: true, reason: null };
  }
  const data = await response.json().catch(() => ({}));
  return {
    ok: false,
    reason: String(data?.error?.message || 'Unable to set Google Drive file permission.'),
    status: Number(response.status || 0) || null,
  };
}

async function uploadImageFromDisk(localPath, options = {}) {
  const config = await getStorageConfig();
  const selectedProvider = resolveUploadProvider(config, options.targetKey);
  if (selectedProvider === 'google_drive') {
    if (!config.isGoogleDriveConfigured) {
      throw new StorageProviderError(
        'GOOGLE_DRIVE_NOT_CONNECTED',
        'Google Drive is selected for this upload field but is not fully connected.'
      );
    }

    const authHeader = await getGoogleDriveAuthorizationHeader(config);
    const bodyBuffer = await fs.promises.readFile(localPath);
    const fileName = String(options.fileName || `upload-${Date.now()}`).trim();
    const folder = trimOrEmpty(options.folder || 'uploads');
    const mimeType = options.contentType || 'application/octet-stream';
    const safeFileName = fileName.replace(/[\\/]/g, '-');
    const driveFileName = folder
      ? `${folder.replace(/^\/+|\/+$/g, '').replace(/[\\/]/g, '-')}-${safeFileName}`
      : safeFileName;

    const boundary = `bizassistant-${crypto.randomBytes(16).toString('hex')}`;
    const parentId = trimOrEmpty(config.googleDrive.folderId);
    const uploadMultipart = async (parents = []) => {
      const metadata = { name: driveFileName };
      if (Array.isArray(parents) && parents.length > 0) {
        metadata.parents = parents;
      }
      const multipartStart = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify(metadata),
        `--${boundary}`,
        `Content-Type: ${mimeType}`,
        '',
      ].join('\r\n');
      const multipartEnd = `\r\n--${boundary}--`;
      const response = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true',
        {
          method: 'POST',
          headers: {
            Authorization: authHeader,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: Buffer.concat([
            Buffer.from(multipartStart, 'utf8'),
            bodyBuffer,
            Buffer.from(multipartEnd, 'utf8'),
          ]),
        }
      );
      const data = await response.json().catch(() => ({}));
      return { response, data };
    };

    let uploadResult;
    try {
      uploadResult = await uploadMultipart(parentId ? [parentId] : []);
    } catch (err) {
      throw new StorageProviderError(
        'GOOGLE_DRIVE_UPLOAD_ERROR',
        'Unable to reach Google Drive API. Check network/firewall and Google connectivity.',
        {
          provider: 'google_drive',
          originalErrorName: String(err?.name || ''),
          originalErrorMessage: String(err?.message || ''),
        }
      );
    }

    if (!uploadResult.response.ok) {
      const originalMessage = String(
        uploadResult.data?.error?.message || 'Google Drive upload failed.'
      );
      const shouldRetryWithoutParent = Boolean(parentId)
        && /file not found|shared drive|team drive|insufficient permissions/i.test(originalMessage);
      if (shouldRetryWithoutParent) {
        try {
          uploadResult = await uploadMultipart([]);
        } catch (err) {
          throw new StorageProviderError('GOOGLE_DRIVE_UPLOAD_ERROR', originalMessage, {
            provider: 'google_drive',
            folderId: parentId,
            originalErrorName: String(err?.name || ''),
            originalErrorMessage: String(err?.message || ''),
          });
        }
      }
      if (!uploadResult.response.ok) {
        throw new StorageProviderError(
          'GOOGLE_DRIVE_UPLOAD_ERROR',
          String(uploadResult.data?.error?.message || originalMessage),
          {
            provider: 'google_drive',
            folderId: parentId || null,
            httpStatusCode: Number(uploadResult.response.status || 0) || null,
          }
        );
      }
    }
    const uploadData = uploadResult.data || {};

    const fileId = trimOrEmpty(uploadData.id);
    if (!fileId) {
      throw new StorageProviderError(
        'GOOGLE_DRIVE_UPLOAD_ERROR',
        'Google Drive upload did not return a file id.'
      );
    }
    const permissionResult = await ensureGoogleDrivePublicReadable(fileId, authHeader);
    if (!permissionResult.ok) {
      // Keep upload successful even when domain policy blocks "anyone with link".
      logStorageDev('warn', 'Google Drive uploaded but public permission was not applied', {
        fileId,
        reason: permissionResult.reason,
        httpStatusCode: permissionResult.status || null,
      });
    }
    await fs.promises.unlink(localPath).catch(() => undefined);
    return buildGoogleDrivePublicUrl(fileId);
  }

  if (selectedProvider === 'local') {
    return null;
  }

  if (selectedProvider !== 'do_spaces' || !config.isDoSpacesConfigured) {
    throw new StorageProviderError(
      'STORAGE_PROVIDER_NOT_CONFIGURED',
      'DigitalOcean Spaces is selected for this upload field but is not fully configured.'
    );
  }

  const endpoint = normalizeDoSpacesEndpoint(config.doSpaces.endpoint, config.doSpaces.bucket);
  const key = buildObjectKey(
    config.doSpaces,
    options.folder || 'uploads',
    options.fileName || `upload-${Date.now()}`
  );
  const startedAt = Date.now();
  const bodyBuffer = await fs.promises.readFile(localPath);
  logStorageDev('info', 'Upload start', {
    provider: 'do_spaces',
    endpoint: config.doSpaces.endpoint,
    bucket: config.doSpaces.bucket,
    key,
    contentType: options.contentType || 'application/octet-stream',
    sizeBytes: bodyBuffer.length,
  });

  const client = new S3Client({
    region: config.doSpaces.region,
    endpoint,
    credentials: {
      accessKeyId: config.doSpaces.accessKey,
      secretAccessKey: config.doSpaces.secretKey,
    },
  });

  const putObject = async (withAcl) => {
    const response = await client.send(
      new PutObjectCommand({
        Bucket: config.doSpaces.bucket,
        Key: key,
        Body: bodyBuffer,
        ...(withAcl ? { ACL: 'public-read' } : {}),
        ContentType: options.contentType || 'application/octet-stream',
        CacheControl: 'public, max-age=31536000',
      })
    );
    logStorageDev('info', 'Upload success', {
      withAcl,
      httpStatusCode: Number(response?.$metadata?.httpStatusCode || 0) || null,
      requestId:
        String(response?.$metadata?.requestId || response?.$metadata?.extendedRequestId || '')
          .trim() || null,
      durationMs: Date.now() - startedAt,
      key,
    });
    return response;
  };

  try {
    await putObject(true);
  } catch (err) {
    // Some Spaces credentials allow PutObject but not PutObjectAcl.
    // Retry without ACL to support these policies.
    const shouldRetryWithoutAcl =
      Number(err?.$metadata?.httpStatusCode || 0) === 403 ||
      String(err?.name || '').trim() === 'AccessDenied';
    logStorageDev('warn', 'Upload attempt failed', {
      withAcl: true,
      willRetryWithoutAcl: shouldRetryWithoutAcl,
      errorName: String(err?.name || ''),
      errorMessage: String(err?.message || ''),
      httpStatusCode: Number(err?.$metadata?.httpStatusCode || 0) || null,
      requestId:
        String(err?.$metadata?.requestId || err?.$metadata?.extendedRequestId || '').trim() || null,
      key,
    });
    if (shouldRetryWithoutAcl) {
      try {
        await putObject(false);
      } catch (retryErr) {
        logStorageDev('error', 'Retry without ACL failed', {
          withAcl: false,
          errorName: String(retryErr?.name || ''),
          errorMessage: String(retryErr?.message || ''),
          httpStatusCode: Number(retryErr?.$metadata?.httpStatusCode || 0) || null,
          requestId:
            String(retryErr?.$metadata?.requestId || retryErr?.$metadata?.extendedRequestId || '').trim() || null,
          key,
          durationMs: Date.now() - startedAt,
        });
        throw new StorageProviderError('STORAGE_UPLOAD_ERROR', describeStorageError(retryErr), {
          provider: 'do_spaces',
          bucket: config.doSpaces.bucket,
          endpoint: config.doSpaces.endpoint,
          originalErrorName: String(retryErr?.name || ''),
          originalErrorMessage: String(retryErr?.message || ''),
          httpStatusCode: Number(retryErr?.$metadata?.httpStatusCode || 0) || null,
        });
      }
    } else {
      logStorageDev('error', 'Upload failed without retry', {
        withAcl: true,
        errorName: String(err?.name || ''),
        errorMessage: String(err?.message || ''),
        httpStatusCode: Number(err?.$metadata?.httpStatusCode || 0) || null,
        requestId:
          String(err?.$metadata?.requestId || err?.$metadata?.extendedRequestId || '').trim() || null,
        key,
        durationMs: Date.now() - startedAt,
      });
      throw new StorageProviderError('STORAGE_UPLOAD_ERROR', describeStorageError(err), {
        provider: 'do_spaces',
        bucket: config.doSpaces.bucket,
        endpoint: config.doSpaces.endpoint,
        originalErrorName: String(err?.name || ''),
        originalErrorMessage: String(err?.message || ''),
        httpStatusCode: Number(err?.$metadata?.httpStatusCode || 0) || null,
      });
    }
  }

  await fs.promises.unlink(localPath).catch(() => undefined);
  return buildPublicUrl(config.doSpaces, key);
}

function extractObjectKeyFromUrl(fileUrl, doSpacesConfig) {
  const rawUrl = trimOrEmpty(fileUrl);
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_err) {
    return null;
  }

  const cdnBaseUrl = trimOrEmpty(doSpacesConfig.cdnBaseUrl);
  if (cdnBaseUrl) {
    const normalizedBase = cdnBaseUrl.replace(/\/+$/, '');
    if (rawUrl.startsWith(`${normalizedBase}/`)) {
      return decodeObjectKey(rawUrl.slice(normalizedBase.length + 1));
    }
  }

  const endpointHost = toEndpointHost(doSpacesConfig.endpoint);
  const bucket = trimOrEmpty(doSpacesConfig.bucket);
  const host = String(parsed.host || '').toLowerCase();
  const bucketHost = `${bucket.toLowerCase()}.${endpointHost.toLowerCase()}`;
  const pathNoSlash = String(parsed.pathname || '').replace(/^\/+/, '');

  if (host === bucketHost) {
    return decodeObjectKey(pathNoSlash);
  }
  if (host === String(endpointHost || '').toLowerCase()) {
    if (pathNoSlash.toLowerCase().startsWith(`${bucket.toLowerCase()}/`)) {
      return decodeObjectKey(pathNoSlash.slice(bucket.length + 1));
    }
  }

  return null;
}

async function deleteRemoteFileByUrl(fileUrl) {
  const config = await getStorageConfig();
  const fileId = extractGoogleDriveFileId(fileUrl);
  if (fileId) {
    if (!config.isGoogleDriveConfigured) {
      return { deleted: false, skipped: true, reason: 'provider_not_configured' };
    }
    const authHeader = await getGoogleDriveAuthorizationHeader(config);
    const response = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
      {
        method: 'DELETE',
        headers: {
          Authorization: authHeader,
        },
      }
    );
    if (!response.ok && response.status !== 404) {
      const data = await response.json().catch(() => ({}));
      throw new StorageProviderError(
        'GOOGLE_DRIVE_DELETE_ERROR',
        String(data?.error?.message || 'Google Drive delete failed.')
      );
    }
    return { deleted: true, skipped: false };
  }

  if (!config.isDoSpacesConfigured) {
    return { deleted: false, skipped: true, reason: 'provider_not_configured' };
  }

  const key = extractObjectKeyFromUrl(fileUrl, config.doSpaces);
  if (!key) {
    return { deleted: false, skipped: true, reason: 'url_not_bucket_object' };
  }

  const endpoint = normalizeDoSpacesEndpoint(config.doSpaces.endpoint, config.doSpaces.bucket);
  const client = new S3Client({
    region: config.doSpaces.region,
    endpoint,
    credentials: {
      accessKeyId: config.doSpaces.accessKey,
      secretAccessKey: config.doSpaces.secretKey,
    },
  });

  try {
    const response = await client.send(
      new DeleteObjectCommand({
        Bucket: config.doSpaces.bucket,
        Key: key,
      })
    );
    logStorageDev('info', 'Delete success', {
      bucket: config.doSpaces.bucket,
      key,
      httpStatusCode: Number(response?.$metadata?.httpStatusCode || 0) || null,
      requestId:
        String(response?.$metadata?.requestId || response?.$metadata?.extendedRequestId || '')
          .trim() || null,
    });
    return { deleted: true, skipped: false };
  } catch (err) {
    logStorageDev('warn', 'Delete failed', {
      bucket: config.doSpaces.bucket,
      key,
      errorName: String(err?.name || ''),
      errorMessage: String(err?.message || ''),
      httpStatusCode: Number(err?.$metadata?.httpStatusCode || 0) || null,
      requestId:
        String(err?.$metadata?.requestId || err?.$metadata?.extendedRequestId || '').trim() || null,
    });
    throw new StorageProviderError('STORAGE_DELETE_ERROR', describeStorageError(err), {
      provider: 'do_spaces',
      bucket: config.doSpaces.bucket,
      endpoint: config.doSpaces.endpoint,
      key,
      originalErrorName: String(err?.name || ''),
      originalErrorMessage: String(err?.message || ''),
      httpStatusCode: Number(err?.$metadata?.httpStatusCode || 0) || null,
    });
  }
}

async function compressImageAtPath(localPath, maxBytes = 2 * 1024 * 1024) {
  const targetPath = String(localPath || '').trim();
  if (!targetPath) {
    return { compressed: false, bytes: 0 };
  }

  const originalBuffer = await fs.promises.readFile(targetPath);
  if (originalBuffer.length <= maxBytes) {
    return { compressed: false, bytes: originalBuffer.length };
  }

  let sharpLib;
  try {
    // eslint-disable-next-line global-require, import/no-extraneous-dependencies
    sharpLib = require('sharp');
  } catch (_err) {
    return { compressed: false, bytes: originalBuffer.length };
  }

  let instance = sharpLib(originalBuffer, { failOnError: false });
  const metadata = await instance.metadata();
  const baseWidth = Number(metadata.width || 0);
  const format = String(metadata.format || 'jpeg').toLowerCase();
  const supported = ['jpeg', 'jpg', 'png', 'webp', 'avif', 'heif'];
  const outputFormat = supported.includes(format) ? format : 'jpeg';

  let bestBuffer = null;
  let bestSize = Number.MAX_SAFE_INTEGER;
  const qualitySteps = [85, 75, 65, 55, 45, 35];
  const resizeFactors = [1, 0.9, 0.8, 0.7, 0.6];

  for (const factor of resizeFactors) {
    const width = baseWidth > 0 ? Math.max(320, Math.floor(baseWidth * factor)) : undefined;
    for (const quality of qualitySteps) {
      let candidate = sharpLib(originalBuffer, { failOnError: false });
      if (width && baseWidth > width) {
        candidate = candidate.resize({ width, withoutEnlargement: true, fit: 'inside' });
      }

      switch (outputFormat) {
        case 'png':
          candidate = candidate.png({
            quality,
            compressionLevel: 9,
            palette: true,
            effort: 10,
          });
          break;
        case 'webp':
          candidate = candidate.webp({ quality, effort: 6 });
          break;
        case 'avif':
          candidate = candidate.avif({ quality, effort: 6 });
          break;
        default:
          candidate = candidate.jpeg({ quality, mozjpeg: true });
          break;
      }

      // eslint-disable-next-line no-await-in-loop
      const output = await candidate.toBuffer();
      const size = output.length;
      if (size < bestSize) {
        bestSize = size;
        bestBuffer = output;
      }
      if (size <= maxBytes) {
        await fs.promises.writeFile(targetPath, output);
        return { compressed: true, bytes: size };
      }
    }
  }

  if (bestBuffer && bestBuffer.length < originalBuffer.length) {
    await fs.promises.writeFile(targetPath, bestBuffer);
    return { compressed: true, bytes: bestBuffer.length };
  }

  return { compressed: false, bytes: originalBuffer.length };
}

module.exports = {
  STORAGE_KEYS,
  StorageProviderError,
  compressImageAtPath,
  deleteRemoteFileByUrl,
  getStorageConfig,
  uploadImageFromDisk,
};

const crypto = require('crypto');
const { getModels } = require('../sequelize');
const {
  getCacheEnabled,
  setCacheEnabled,
} = require('../services/cache-service');
const {
  STORAGE_KEYS,
  getStorageConfig,
  StorageProviderError,
} = require('../services/storage-service');

function isSuperuser(req) {
  const roleCodes = req.auth?.roleCodes || [];
  return roleCodes.some((code) => String(code || '').toLowerCase() === 'superuser');
}

function getSettingsReturnPath(rawPath) {
  const value = String(rawPath || '/settings').trim();
  if (!value.startsWith('/')) {
    return '/settings';
  }
  return value;
}

function buildAppUrl(pathAndQuery = '/settings') {
  const appBaseUrl = String(process.env.APP_BASE_URL || 'http://localhost').trim();
  const base = appBaseUrl.replace(/\/+$/, '');
  const suffix = String(pathAndQuery || '').startsWith('/') ? pathAndQuery : `/${pathAndQuery}`;
  return `${base}${suffix}`;
}

function buildGoogleDriveRedirectUri(overrideUri = '') {
  const trimmedOverride = String(overrideUri || '').trim();
  if (trimmedOverride) {
    return trimmedOverride;
  }
  return buildAppUrl('/api/v1/settings/storage/google-drive/callback');
}

function buildStoragePayload(config) {
  return {
    provider: config.provider,
    uploadTargets: {
      expenseAttachment: config.uploadTargets?.expenseAttachment || config.provider,
      profileImage: config.uploadTargets?.profileImage || config.provider,
    },
    doSpaces: {
      endpoint: config.doSpaces.endpoint,
      region: config.doSpaces.region,
      bucket: config.doSpaces.bucket,
      accessKey: config.doSpaces.accessKey,
      secretKey: config.doSpaces.secretKey ? '********' : '',
      hasSecretKey: Boolean(config.doSpaces.secretKey),
      cdnBaseUrl: config.doSpaces.cdnBaseUrl,
      directory: config.doSpaces.directory,
    },
    googleDrive: {
      clientId: config.googleDrive.clientId,
      clientSecret: config.googleDrive.clientSecret ? '********' : '',
      hasClientSecret: Boolean(config.googleDrive.clientSecret),
      redirectUri: config.googleDrive.redirectUri,
      folderId: config.googleDrive.folderId,
      accountEmail: config.googleDrive.accountEmail,
      hasRefreshToken: Boolean(config.googleDrive.refreshToken),
      scope: config.googleDrive.scope,
    },
    isDoSpacesConfigured: config.isDoSpacesConfigured,
    isGoogleDriveConfigured: config.isGoogleDriveConfigured,
  };
}

async function getCacheSetting(req, res) {
  try {
    if (!isSuperuser(req)) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only superuser can access cache settings.',
      });
    }

    const models = getModels();
    if (!models || !models.AppSetting) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const setting = await models.AppSetting.findOne({
      where: { key: 'cache_enabled' },
    });

    const enabled = setting?.valueBoolean === undefined || setting?.valueBoolean === null
      ? getCacheEnabled()
      : Boolean(setting.valueBoolean);

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Cache setting fetched successfully.',
      data: {
        key: 'cache_enabled',
        enabled,
      },
    });
  } catch (err) {
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Unable to fetch cache setting.',
    });
  }
}

async function updateCacheSetting(req, res) {
  try {
    if (!isSuperuser(req)) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only superuser can update cache settings.',
      });
    }

    const models = getModels();
    if (!models || !models.AppSetting) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const enabled = req.body?.enabled;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'enabled must be a boolean.',
      });
    }

    const [setting, created] = await models.AppSetting.findOrCreate({
      where: { key: 'cache_enabled' },
      defaults: {
        key: 'cache_enabled',
        valueBoolean: enabled,
        description: 'Global toggle for Redis API response cache',
        updatedBy: req.auth?.userId || null,
      },
    });

    if (!created) {
      await setting.update({
        valueBoolean: enabled,
        updatedBy: req.auth?.userId || null,
      });
    }

    await setCacheEnabled(enabled);

    return res.status(200).json({
      code: 'SUCCESS',
      message: `Cache ${enabled ? 'enabled' : 'disabled'} successfully.`,
      data: {
        key: 'cache_enabled',
        enabled,
      },
    });
  } catch (err) {
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Unable to update cache setting.',
    });
  }
}

async function upsertTextSetting(AppSetting, key, value, description, updatedBy) {
  const [setting, created] = await AppSetting.findOrCreate({
    where: { key },
    defaults: {
      key,
      valueText: value,
      description,
      updatedBy,
    },
  });

  if (!created) {
    await setting.update({
      valueText: value,
      description: description || setting.description || null,
      updatedBy,
    });
  }
}

async function getStorageSetting(req, res) {
  try {
    if (!isSuperuser(req)) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only superuser can access storage settings.',
      });
    }

    const config = await getStorageConfig();
    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Storage setting fetched successfully.',
      data: buildStoragePayload(config),
    });
  } catch (err) {
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Unable to fetch storage setting.',
    });
  }
}

async function updateStorageSetting(req, res) {
  try {
    if (!isSuperuser(req)) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only superuser can update storage settings.',
      });
    }

    const models = getModels();
    if (!models || !models.AppSetting) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const provider = String(req.body?.provider || 'local').trim().toLowerCase();
    if (!['local', 'do_spaces', 'google_drive'].includes(provider)) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'provider must be either local, do_spaces, or google_drive.',
      });
    }

    const googleDriveBody = req.body?.googleDrive || {};
    const uploadTargetsBody = req.body?.uploadTargets || {};
    const expenseAttachmentProvider = String(
      uploadTargetsBody.expenseAttachment || provider
    ).trim().toLowerCase();
    const profileImageProvider = String(
      uploadTargetsBody.profileImage || provider
    ).trim().toLowerCase();
    if (![provider, expenseAttachmentProvider, profileImageProvider].every((candidate) =>
      ['local', 'do_spaces', 'google_drive'].includes(candidate)
    )) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'provider/uploadTargets must be local, do_spaces, or google_drive.',
      });
    }
    const requiresDoSpaces = [provider, expenseAttachmentProvider, profileImageProvider].includes('do_spaces');
    const requiresGoogleDrive = [provider, expenseAttachmentProvider, profileImageProvider].includes('google_drive');
    const doSpacesBody = req.body?.doSpaces || {};
    const endpoint = String(doSpacesBody.endpoint || '').trim();
    const region = String(doSpacesBody.region || '').trim();
    const bucket = String(doSpacesBody.bucket || '').trim();
    const accessKey = String(doSpacesBody.accessKey || '').trim();
    const secretKeyInput = String(doSpacesBody.secretKey || '').trim();
    const cdnBaseUrl = String(doSpacesBody.cdnBaseUrl || '').trim();
    const directory = String(doSpacesBody.directory || '').trim();
    if (requiresDoSpaces && (!endpoint || !region || !bucket || !accessKey)) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'DO Spaces endpoint, region, bucket, and accessKey are required.',
      });
    }
    const googleClientId = String(googleDriveBody.clientId || '').trim();
    const googleClientSecretInput = String(googleDriveBody.clientSecret || '').trim();
    const googleFolderId = String(googleDriveBody.folderId || '').trim();
    const googleRedirectUri = buildGoogleDriveRedirectUri(googleDriveBody.redirectUri);

    const { AppSetting } = models;
    const updatedBy = req.auth?.userId || null;

    const existingSecret = await AppSetting.findOne({
      where: { key: STORAGE_KEYS.secretKey },
      attributes: ['valueText'],
    });
    const finalSecret = secretKeyInput || String(existingSecret?.valueText || '').trim();
    if (requiresDoSpaces && !finalSecret) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'DO Spaces secretKey is required.',
      });
    }

    const existingGoogleSecret = await AppSetting.findOne({
      where: { key: STORAGE_KEYS.googleDriveClientSecret },
      attributes: ['valueText'],
    });
    const finalGoogleClientSecret =
      googleClientSecretInput || String(existingGoogleSecret?.valueText || '').trim();
    if (requiresGoogleDrive && (!googleClientId || !finalGoogleClientSecret)) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'Google Drive clientId and clientSecret are required.',
      });
    }

    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.provider,
      provider,
      'Global file storage provider: local, do_spaces, or google_drive',
      updatedBy
    );
    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.expenseAttachmentProvider,
      expenseAttachmentProvider,
      'Storage provider for expense attachment uploads',
      updatedBy
    );
    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.profileImageProvider,
      profileImageProvider,
      'Storage provider for profile image uploads',
      updatedBy
    );
    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.endpoint,
      endpoint,
      'DigitalOcean Spaces endpoint (example: nyc3.digitaloceanspaces.com)',
      updatedBy
    );
    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.region,
      region,
      'DigitalOcean Spaces region (example: nyc3)',
      updatedBy
    );
    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.bucket,
      bucket,
      'DigitalOcean Spaces bucket name',
      updatedBy
    );
    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.accessKey,
      accessKey,
      'DigitalOcean Spaces access key',
      updatedBy
    );
    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.secretKey,
      finalSecret,
      'DigitalOcean Spaces secret key',
      updatedBy
    );
    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.cdnBaseUrl,
      cdnBaseUrl,
      'Optional public CDN/base URL for files',
      updatedBy
    );
    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.directory,
      directory,
      'Optional base directory/prefix inside bucket',
      updatedBy
    );

    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.googleDriveClientId,
      googleClientId,
      'Google Drive OAuth client id',
      updatedBy
    );
    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.googleDriveClientSecret,
      finalGoogleClientSecret,
      'Google Drive OAuth client secret',
      updatedBy
    );
    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.googleDriveRedirectUri,
      googleRedirectUri,
      'Google Drive OAuth redirect URI',
      updatedBy
    );
    await upsertTextSetting(
      AppSetting,
      STORAGE_KEYS.googleDriveFolderId,
      googleFolderId,
      'Google Drive folder ID for uploaded files (optional)',
      updatedBy
    );

    const config = await getStorageConfig();
    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Storage settings updated successfully.',
      data: buildStoragePayload(config),
    });
  } catch (err) {
    if (err instanceof StorageProviderError) {
      return res.status(502).json({
        code: err.code || 'STORAGE_ERROR',
        message: err.message || 'Storage provider operation failed.',
      });
    }
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Unable to update storage setting.',
    });
  }
}

async function getGoogleDriveAuthUrl(req, res) {
  try {
    if (!isSuperuser(req)) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only superuser can connect Google Drive.',
      });
    }

    const models = getModels();
    if (!models || !models.AppSetting) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const config = await getStorageConfig();
    if (!config.googleDrive.clientId || !config.googleDrive.clientSecret) {
      return res.status(400).json({
        code: 'BAD_REQUEST',
        message: 'Google Drive client id/secret must be saved first.',
      });
    }

    const returnPath = getSettingsReturnPath(req.query?.returnPath || '/settings');
    const statePayload = {
      userId: req.auth?.userId || null,
      nonce: crypto.randomBytes(16).toString('hex'),
      returnPath,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };

    await upsertTextSetting(
      models.AppSetting,
      STORAGE_KEYS.googleDriveOauthState,
      JSON.stringify(statePayload),
      'Google Drive OAuth CSRF state and callback context',
      req.auth?.userId || null
    );

    const scope = encodeURIComponent('https://www.googleapis.com/auth/drive.file');
    const redirectUri = encodeURIComponent(config.googleDrive.redirectUri);
    const authUrl =
      'https://accounts.google.com/o/oauth2/v2/auth'
      + `?client_id=${encodeURIComponent(config.googleDrive.clientId)}`
      + `&redirect_uri=${redirectUri}`
      + '&response_type=code'
      + `&scope=${scope}`
      + '&access_type=offline'
      + '&prompt=consent'
      + '&include_granted_scopes=true'
      + `&state=${encodeURIComponent(Buffer.from(JSON.stringify(statePayload)).toString('base64url'))}`;

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Google Drive auth URL generated.',
      data: {
        url: authUrl,
      },
    });
  } catch (err) {
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Unable to generate Google Drive auth URL.',
    });
  }
}

async function handleGoogleDriveCallback(req, res) {
  const failRedirect = (reason, returnPath = '/settings') =>
    res.redirect(buildAppUrl(`${returnPath}?gdrive=${encodeURIComponent(reason)}`));

  try {
    const code = String(req.query?.code || '').trim();
    const state = String(req.query?.state || '').trim();
    const oauthError = String(req.query?.error || '').trim();

    if (oauthError) {
      return failRedirect('oauth_denied');
    }
    if (!code || !state) {
      return failRedirect('invalid_callback');
    }

    const models = getModels();
    if (!models || !models.AppSetting) {
      return failRedirect('service_unavailable');
    }

    const savedStateSetting = await models.AppSetting.findOne({
      where: { key: STORAGE_KEYS.googleDriveOauthState },
      attributes: ['valueText'],
    });
    const savedStateRaw = String(savedStateSetting?.valueText || '').trim();
    const savedState = savedStateRaw ? JSON.parse(savedStateRaw) : null;

    const decodedStateRaw = Buffer.from(state, 'base64url').toString('utf8');
    const decodedState = decodedStateRaw ? JSON.parse(decodedStateRaw) : null;

    const returnPath = getSettingsReturnPath(decodedState?.returnPath || savedState?.returnPath || '/settings');
    if (!savedState || !decodedState || savedState.nonce !== decodedState.nonce) {
      return failRedirect('invalid_state', returnPath);
    }

    const stateExpiry = Date.parse(String(savedState.expiresAt || ''));
    if (Number.isFinite(stateExpiry) && stateExpiry < Date.now()) {
      return failRedirect('state_expired', returnPath);
    }

    const config = await getStorageConfig();
    if (!config.googleDrive.clientId || !config.googleDrive.clientSecret) {
      return failRedirect('missing_oauth_config', returnPath);
    }

    const tokenParams = new URLSearchParams();
    tokenParams.set('code', code);
    tokenParams.set('client_id', config.googleDrive.clientId);
    tokenParams.set('client_secret', config.googleDrive.clientSecret);
    tokenParams.set('redirect_uri', config.googleDrive.redirectUri);
    tokenParams.set('grant_type', 'authorization_code');

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: tokenParams.toString(),
    });

    const tokenData = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok) {
      return failRedirect('token_exchange_failed', returnPath);
    }

    const accessToken = String(tokenData.access_token || '').trim();
    const refreshToken =
      String(tokenData.refresh_token || '').trim() || String(config.googleDrive.refreshToken || '').trim();
    if (!accessToken || !refreshToken) {
      return failRedirect('token_missing', returnPath);
    }

    let accountEmail = '';
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    if (userInfoResponse.ok) {
      const userInfo = await userInfoResponse.json().catch(() => ({}));
      accountEmail = String(userInfo?.email || '').trim();
    }

    const expiresIn = Number(tokenData.expires_in || 0);
    const expiryDate = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : '';
    const updatedBy = null;

    await upsertTextSetting(
      models.AppSetting,
      STORAGE_KEYS.googleDriveAccessToken,
      accessToken,
      'Google Drive OAuth access token',
      updatedBy
    );
    await upsertTextSetting(
      models.AppSetting,
      STORAGE_KEYS.googleDriveRefreshToken,
      refreshToken,
      'Google Drive OAuth refresh token',
      updatedBy
    );
    await upsertTextSetting(
      models.AppSetting,
      STORAGE_KEYS.googleDriveTokenType,
      String(tokenData.token_type || 'Bearer').trim(),
      'Google Drive OAuth token type',
      updatedBy
    );
    await upsertTextSetting(
      models.AppSetting,
      STORAGE_KEYS.googleDriveExpiryDate,
      expiryDate,
      'Google Drive OAuth access token expiry',
      updatedBy
    );
    await upsertTextSetting(
      models.AppSetting,
      STORAGE_KEYS.googleDriveScope,
      String(tokenData.scope || '').trim(),
      'Google Drive OAuth scope',
      updatedBy
    );
    await upsertTextSetting(
      models.AppSetting,
      STORAGE_KEYS.googleDriveAccountEmail,
      accountEmail,
      'Google Drive connected account email',
      updatedBy
    );
    await upsertTextSetting(
      models.AppSetting,
      STORAGE_KEYS.googleDriveOauthState,
      '',
      'Google Drive OAuth CSRF state and callback context',
      updatedBy
    );

    return res.redirect(buildAppUrl(`${returnPath}?gdrive=connected`));
  } catch (_err) {
    return failRedirect('callback_error');
  }
}

async function disconnectGoogleDrive(req, res) {
  try {
    if (!isSuperuser(req)) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: 'Only superuser can disconnect Google Drive.',
      });
    }

    const models = getModels();
    if (!models || !models.AppSetting) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const updatedBy = req.auth?.userId || null;
    const keysToClear = [
      STORAGE_KEYS.googleDriveAccessToken,
      STORAGE_KEYS.googleDriveRefreshToken,
      STORAGE_KEYS.googleDriveTokenType,
      STORAGE_KEYS.googleDriveExpiryDate,
      STORAGE_KEYS.googleDriveScope,
      STORAGE_KEYS.googleDriveAccountEmail,
      STORAGE_KEYS.googleDriveOauthState,
    ];

    for (const key of keysToClear) {
      // eslint-disable-next-line no-await-in-loop
      await upsertTextSetting(models.AppSetting, key, '', `Cleared ${key}`, updatedBy);
    }

    const config = await getStorageConfig();
    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Google Drive disconnected successfully.',
      data: buildStoragePayload(config),
    });
  } catch (_err) {
    return res.status(500).json({
      code: 'INTERNAL_ERROR',
      message: 'Unable to disconnect Google Drive.',
    });
  }
}

module.exports = {
  getCacheSetting,
  updateCacheSetting,
  getStorageSetting,
  updateStorageSetting,
  getGoogleDriveAuthUrl,
  handleGoogleDriveCallback,
  disconnectGoogleDrive,
};

const path = require('path');
const bcrypt = require('bcryptjs');
const { getModels } = require('../sequelize');
const {
  compressImageAtPath,
  deleteRemoteFileByUrl,
  uploadImageFromDisk,
  StorageProviderError,
} = require('../services/storage-service');

function sanitizeUser(user) {
  const json = user.toJSON();
  delete json.password;
  return json;
}

function optionalString(value) {
  const cleaned = String(value || '').trim();
  return cleaned || undefined;
}

async function resolveUploadedProfileImage(req) {
  if (!req || !req.file || !req.file.filename) {
    return undefined;
  }

  const localPath = String(req.file.path || '').trim();
  if (localPath) {
    await compressImageAtPath(localPath, 2 * 1024 * 1024);
    const uploadedUrl = await uploadImageFromDisk(localPath, {
      targetKey: 'profile_image',
      folder: 'profiles',
      fileName: req.file.filename,
      contentType: req.file.mimetype || undefined,
    });
    if (uploadedUrl) {
      return {
        profileImageUrl: uploadedUrl,
        profileImageCdnUrl: uploadedUrl,
      };
    }
  }

  return {
    profileImageUrl: `/uploads/profiles/${path.basename(req.file.filename)}`,
    profileImageCdnUrl: null,
  };
}

async function buildProfilePayload(req) {
  const body = req.body || {};
  const payload = {
    firstName: optionalString(body.firstName),
    lastName: optionalString(body.lastName),
    email: optionalString(body.email),
    phone: optionalString(body.phone),
    addressLine1: optionalString(body.addressLine1),
    addressLine2: optionalString(body.addressLine2),
    city: optionalString(body.city),
    state: optionalString(body.state),
    postalCode: optionalString(body.postalCode),
    country: optionalString(body.country),
  };

  const password = optionalString(body.password);
  if (password) {
    payload.password = password;
  }

  const uploadedImage = await resolveUploadedProfileImage(req);
  if (uploadedImage) {
    payload.profileImageUrl = uploadedImage.profileImageUrl;
    payload.profileImageCdnUrl = uploadedImage.profileImageCdnUrl;
  }

  if (payload.email) {
    payload.email = payload.email.toLowerCase();
  }

  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

async function getMyProfile(req, res) {
  try {
    const models = getModels();
    if (!models || !models.User) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const userId = String(req.auth?.userId || '').trim();
    if (!userId) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
    }

    const user = await models.User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'User not found.',
      });
    }

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Profile fetched successfully.',
      data: sanitizeUser(user),
    });
  } catch (err) {
    return res.status(500).json({
      code: 'PROFILE_FETCH_ERROR',
      message: 'Unable to fetch profile.',
    });
  }
}

async function updateMyProfile(req, res) {
  try {
    const models = getModels();
    if (!models || !models.User) {
      return res.status(503).json({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Database models are not ready yet.',
      });
    }

    const userId = String(req.auth?.userId || '').trim();
    if (!userId) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        message: 'Authentication required.',
      });
    }

    const user = await models.User.findByPk(userId);
    if (!user) {
      return res.status(404).json({
        code: 'NOT_FOUND',
        message: 'User not found.',
      });
    }

    const previousProfileImageUrls = Array.from(
      new Set(
        [
          String(user.profileImageCdnUrl || '').trim(),
          String(user.profileImageUrl || '').trim(),
        ].filter(Boolean)
      )
    );
    // If the request includes a password change, verify the current password first
    const newPassword = String(req.body?.password || '').trim();
    if (newPassword) {
      const currentPassword = String(req.body?.currentPassword || '').trim();
      if (!currentPassword) {
        return res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: 'Current password is required to set a new password.',
        });
      }
      let passwordMatches = false;
      try {
        passwordMatches = await bcrypt.compare(currentPassword, user.password);
      } catch (_err) {
        passwordMatches = currentPassword === user.password;
      }
      if (!passwordMatches) {
        return res.status(400).json({
          code: 'VALIDATION_ERROR',
          message: 'Current password is incorrect.',
        });
      }
    }

    const payload = await buildProfilePayload(req);
    if (Object.keys(payload).length === 0) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'No valid profile fields were provided.',
      });
    }

    await user.update(payload);
    if (
      payload.profileImageUrl
    ) {
      const newProfileImageUrls = Array.from(
        new Set(
          [
            String(payload.profileImageCdnUrl || '').trim(),
            String(payload.profileImageUrl || '').trim(),
          ].filter(Boolean)
        )
      );
      const staleProfileImageUrls = previousProfileImageUrls.filter(
        (url) => !newProfileImageUrls.includes(url)
      );
      for (const staleUrl of staleProfileImageUrls) {
        try {
          // Best-effort cleanup; profile update remains successful.
          // eslint-disable-next-line no-await-in-loop
          await deleteRemoteFileByUrl(staleUrl);
        } catch (_err) {
          // Best-effort cleanup; profile update remains successful.
        }
      }
    }

    return res.status(200).json({
      code: 'SUCCESS',
      message: 'Profile updated successfully.',
      data: sanitizeUser(user),
    });
  } catch (err) {
    if (err instanceof StorageProviderError) {
      return res.status(502).json({
        code: err.code || 'STORAGE_UPLOAD_ERROR',
        message: err.message || 'Unable to upload profile image to cloud storage.',
      });
    }
    return res.status(500).json({
      code: 'PROFILE_UPDATE_ERROR',
      message: 'Unable to update profile.',
    });
  }
}

module.exports = {
  getMyProfile,
  updateMyProfile,
};

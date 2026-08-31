const crypto =
  require("crypto");

const {
  defineSecret,
} = require("firebase-functions/params");


const GMAIL_TOKEN_ENCRYPTION_KEY =
  defineSecret(
    "GMAIL_TOKEN_ENCRYPTION_KEY"
  );


const TOKEN_VERSION =
  "aes-256-gcm-v1";


function encryptionKey() {

  const raw =
    String(
      GMAIL_TOKEN_ENCRYPTION_KEY.value()
      ||
      ""
    )
    .trim();

  if (!raw) {
    throw new Error(
      "GMAIL_TOKEN_ENCRYPTION_KEY non configurata."
    );
  }

  let key;

  try {
    key =
      Buffer.from(
        raw,
        "base64"
      );
  }
  catch(error) {
    throw new Error(
      "GMAIL_TOKEN_ENCRYPTION_KEY non è Base64 valida."
    );
  }

  if (
    key.length !==
    32
  ) {
    throw new Error(
      "GMAIL_TOKEN_ENCRYPTION_KEY deve rappresentare esattamente 32 byte (AES-256)."
    );
  }

  return key;

}


function encryptRefreshToken(
  token
) {

  const plain =
    String(
      token
      ||
      ""
    );

  if (!plain) {
    throw new Error(
      "Refresh token vuoto."
    );
  }

  /*
   * AES-256-GCM:
   * - chiave 256 bit;
   * - IV casuale 96 bit;
   * - authentication tag per rilevare alterazioni.
   */
  const iv =
    crypto.randomBytes(
      12
    );

  const cipher =
    crypto.createCipheriv(
      "aes-256-gcm",
      encryptionKey(),
      iv
    );

  const encrypted =
    Buffer.concat([
      cipher.update(
        plain,
        "utf8"
      ),

      cipher.final(),
    ]);

  const tag =
    cipher.getAuthTag();

  return {
    refreshTokenEncrypted:
      encrypted.toString(
        "base64"
      ),

    refreshTokenIv:
      iv.toString(
        "base64"
      ),

    refreshTokenTag:
      tag.toString(
        "base64"
      ),

    refreshTokenEncryption:
      TOKEN_VERSION,
  };

}


function decryptRefreshToken(
  data = {}
) {

  /*
   * Nuovo formato cifrato.
   */
  if (
    data.refreshTokenEncrypted
    &&
    data.refreshTokenIv
    &&
    data.refreshTokenTag
  ) {

    const decipher =
      crypto.createDecipheriv(
        "aes-256-gcm",

        encryptionKey(),

        Buffer.from(
          data.refreshTokenIv,
          "base64"
        )
      );

    decipher.setAuthTag(
      Buffer.from(
        data.refreshTokenTag,
        "base64"
      )
    );

    const plain =
      Buffer.concat([
        decipher.update(
          Buffer.from(
            data.refreshTokenEncrypted,
            "base64"
          )
        ),

        decipher.final(),
      ])
      .toString(
        "utf8"
      );

    return {
      token:
        plain,

      encrypted:
        true,

      legacyPlaintext:
        false,
    };
  }


  /*
   * Compatibilità temporanea con connessioni create dalla PATCH precedente.
   * Al primo sync il motore le migra automaticamente ad AES-256-GCM.
   */
  if (
    data.refreshToken
  ) {
    return {
      token:
        String(
          data.refreshToken
        ),

      encrypted:
        false,

      legacyPlaintext:
        true,
    };
  }


  throw new Error(
    "Refresh token Gmail non disponibile."
  );

}


module.exports = {
  GMAIL_TOKEN_ENCRYPTION_KEY,
  TOKEN_VERSION,
  encryptRefreshToken,
  decryptRefreshToken,
};

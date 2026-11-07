// Tests must never send real email, whatever MAIL_* the workspace .env holds.
// Off by default (signup/login return tokens directly); suites that exercise email
// set MAIL_HOST='json' (builds the messages with no network) themselves.
process.env.MAIL_HOST = '';

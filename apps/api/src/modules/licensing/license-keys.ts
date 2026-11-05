import { Logger } from '@nestjs/common';

const logger = new Logger('LicenseKeys');

// Insecure, dev-only RS256 pair — same role as jwt-config.module.ts's
// INSECURE_DEV_SECRET. The public half is also what a dev build of the
// desktop app embeds. Production must set LICENSE_PRIVATE_KEY /
// LICENSE_PUBLIC_KEY (PEM, "\n"-escaped on one line is fine), and the
// desktop release build must embed that same public key.
const DEV_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDrMWlUFtzwoSVG
A0kMcPnRKwA9JxcIB+lUE30lm4NtzgmZybwqwHmnhw1Sz2HM63UM4Mz79Jd6yYR1
G4lbCq9062DHkHWliLzERDCxXIuB7o5mGLDb5epuzGtyEhx+a+hpy4L5AWpPcgLp
brBefdR4rWV19LTN59446+Rmh0dtHYU1YTPzEvkgPfSdYhNjRe24GN60UYo9yJjp
petkrpCuByhz4x7EuTcsMhfozYE1baj5p5fhiSzNPIN72wfY1rE8IpaEkaMETQ/L
81SlQaUoQcnc5SNUKxUPDfibfgRmRVxs/PAwiN12JzeKcJRT7B6d7ayy1b5zUpV7
Jn/CVminAgMBAAECggEAXAOw2Z04Q0xIcOPIKH3qvtK7/TDV6eZuet5FD/mPqd36
E5jBbVhwQAKuS7+m260i1i79A3Xl7bv5fnePfXbovi14Z5s069ZbQ84J3tn+Go9i
Vr9CMkX5Oe/v+WjsjOlavElKrHDJTtukF/+eMNm5zpzIHSXntscIQezIJvS2FRG/
bu161L21SwZfq5OvFfrX+DwBtgZRsxsmombeSZnZ490OY7pHEvWDjtp4jHnUf2em
bFjVxQfPPFv32wBN+x7plye4hgSjuLbdIFj72BV3t/PhGyHVP+yLH/RyNWwBRQGf
SXgQMT3w1GsUfmixn/DfI3Z8KKW5ju4WtdQDYXWhwQKBgQD/GLRJE202cXdKtiU/
cvrsNtMpaD38tbEA5oRmTmuiBYXmpob2/PtUXKrrjAXCLxBjBAK18yr8faU6C4br
Nuq3Zkh7NwevLrIOyf+WQMMVektx2UaJFBTpdXBF1Vly+PO0ZanvE7/9MJ0EkUMi
hfm9DcgN+cIND636Io9d7wpXrQKBgQDsBqklUfGKrtG9SyDD3ft4fP/MR+wtWP9L
W0IaIR+DP7gb2ohg1rZke/+NGg+LVVHK/eDtdFfBj/A5yyUiqzfj45PR1xy+50/c
6XMF3sUsQrvdVfEHqWyQmObDNaqcmXYJXZiPHhTREmF0Ivr2jPu8VoAzx1sUTuEE
GmuWjFucIwKBgQDBmrNBft/1YPpDlqgAVrh/zEBI/deF0zOKVmmH596icgSlACAQ
lgH9jfMen//C18tdCq8v/mTSil17B0KXg+9xz8wUz7giSZNTzBURqQcmZtGZj2iM
ItSYNsxGA91GeBEmCb6GN3wPofSZgdHtArd+t1Xs3XBcT1kgLViX1xMHZQKBgQDN
rFw3BjoaZI6milIp/EVHUH3DcKUxOw10iDiI9nY0dBEmTH9tC41y8M7XEW+cNiQJ
ZMRdh3V1Wc23PvvEQzl333ePcwk8nertEY1G/0IIeLqmfF6GE7BkLKliUGC1B9Fh
BeuMQ2VWbtL3VgglUuOG0kXzWPRYNQhGABPi47psywKBgGtsCaSXZkwtwRFfAuTB
h7HY/KkWLdE7QanBVIP/Nb42ekM/0R13gWBRoFiOvSmoSbojPaZE2IBf3ON9zu46
lth6+63KAZQTNKulQjD8vGE+JUcyCxRYmmLvxyldF/SjdtXiNYQ5cuH3qu4tD1f7
83vh3bFhE4J/Jz5KTlkL0NV4
-----END PRIVATE KEY-----`;

export const DEV_LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA6zFpVBbc8KElRgNJDHD5
0SsAPScXCAfpVBN9JZuDbc4Jmcm8KsB5p4cNUs9hzOt1DODM+/SXesmEdRuJWwqv
dOtgx5B1pYi8xEQwsVyLge6OZhiw2+XqbsxrchIcfmvoacuC+QFqT3IC6W6wXn3U
eK1ldfS0zefeOOvkZodHbR2FNWEz8xL5ID30nWITY0XtuBjetFGKPciY6aXrZK6Q
rgcoc+MexLk3LDIX6M2BNW2o+aeX4YkszTyDe9sH2NaxPCKWhJGjBE0Py/NUpUGl
KEHJ3OUjVCsVDw34m34EZkVcbPzwMIjddic3inCUU+wene2sstW+c1KVeyZ/wlZo
pwIDAQAB
-----END PUBLIC KEY-----`;

const fromEnv = (name: string) => process.env[name]?.replace(/\\n/g, '\n');

let cached: { privateKey: string | undefined; publicKey: string } | null = null;

/**
 * The private key is only needed by the server (it signs licenses); a
 * desktop device running the API in local mode only ever verifies, so it
 * has the public key alone and `privateKey` is undefined there.
 */
export function licenseKeys(): { privateKey: string | undefined; publicKey: string } {
  if (cached) return cached;
  const privateKey = fromEnv('LICENSE_PRIVATE_KEY');
  const publicKey = fromEnv('LICENSE_PUBLIC_KEY');
  if (publicKey) {
    cached = { privateKey, publicKey };
  } else if (process.env.NODE_ENV === 'production' && process.env.STOCKILY_LOCAL_MODE !== '1') {
    throw new Error('LICENSE_PRIVATE_KEY and LICENSE_PUBLIC_KEY must be set in production');
  } else {
    logger.warn('LICENSE_PUBLIC_KEY not set — using the insecure dev license keypair.');
    cached = { privateKey: DEV_PRIVATE_KEY, publicKey: DEV_LICENSE_PUBLIC_KEY };
  }
  return cached;
}

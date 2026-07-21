'use strict';

const NAMES = ['OCR', 'DOCUMENT_STORAGE', 'ERP', 'VENDOR_MASTER', 'PURCHASE_ORDERS', 'RECEIPTS', 'PAYMENTS', 'TAX'];

function providerReadiness(env = process.env) {
  const providers = NAMES.map((name) => ({
    name: name.toLowerCase(),
    enabled: env[`${name}_ENABLED`] === 'true',
    ready: env[`${name}_ENABLED`] === 'true' && Boolean(env[`${name}_URL`]) && Boolean(env[`${name}_TOKEN`]),
  }));
  return { ready: providers.every((provider) => provider.ready), providers };
}

function requireProvider(name, env = process.env) {
  const provider = providerReadiness(env).providers.find((entry) => entry.name === String(name).toLowerCase());
  if (!provider?.ready) throw Object.assign(new Error(`${name} provider is not ready`), { code: 'PROVIDER_NOT_READY' });
  return provider;
}

module.exports = { NAMES, providerReadiness, requireProvider };

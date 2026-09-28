// Real source discovery requires the durable two-step owner gate on /sources.
// This legacy convenience command has no loopback form nonce or owner confirmation,
// so it cannot create receipts or enter source transport.
console.error("SOURCE_OWNER_UI_ACTION_REQUIRED");
process.exitCode = 1;

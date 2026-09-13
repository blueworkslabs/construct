// Placeholder module entry for the future runtime contract.
// Expected host bridge shape is intentionally tiny until implemented.
export async function start(construct) {
  await construct.capabilities.call('log.write', {
    level: 'info',
    message: 'Hello Module started',
    fields: { module: 'dev.construct.hello' }
  });

  await construct.capabilities.call('device.toast', {
    message: 'Hello from Construct Runtime'
  });
}

export async function stop(construct) {
  await construct.capabilities.call('log.write', {
    level: 'info',
    message: 'Hello Module stopped',
    fields: { module: 'dev.construct.hello' }
  });
}

export async function getWorkloads() {
  const response = await fetch('/investigator-api/services', { headers: { Accept: 'application/json' }, cache: 'no-store' });
  if (!response.ok) throw new Error(`GET /investigator-api/services returned HTTP ${response.status}`);

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('GET /investigator-api/services did not return JSON');
  }

  if (!Array.isArray(payload.services)) {
    throw new Error('GET /investigator-api/services must return { "services": [...] }');
  }

  return payload.services.map((service) => {
    const { name, readyReplicas, desiredReplicas } = service;
    if (typeof name !== 'string' || !name || !Number.isInteger(readyReplicas) || !Number.isInteger(desiredReplicas)) {
      throw new Error('Each service needs name, readyReplicas, and desiredReplicas fields');
    }
    return {
      name,
      resourceName: service.resourceName || name,
      namespace: service.namespace || 'default',
      ready: readyReplicas,
      desired: desiredReplicas,
      status: readyReplicas >= desiredReplicas ? 'healthy' : 'failing',
    };
  });
}

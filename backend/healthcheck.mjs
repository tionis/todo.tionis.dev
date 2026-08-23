try {
  const port = process.env.PORT || 3030;
  const response = await fetch(`http://127.0.0.1:${port}/api/health`);
  if (!response.ok) process.exitCode = 1;
} catch {
  process.exitCode = 1;
}

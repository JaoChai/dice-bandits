export async function animateThenRender(
  animate: () => Promise<void>,
  render: () => void,
): Promise<void> {
  await animate();
  render();
}

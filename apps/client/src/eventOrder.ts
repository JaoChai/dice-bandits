export async function animateThenRender(
  animate: () => Promise<void>,
  render: () => void,
): Promise<void> {
  // Phaser may discard a tween/timer when a scene shuts down without invoking
  // its completion callback. Presentation must never hold game logic hostage.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      animate(),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, 10_000);
      }),
    ]);
  } catch (error) {
    console.warn('Animation interrupted:', error);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    render();
  }
}

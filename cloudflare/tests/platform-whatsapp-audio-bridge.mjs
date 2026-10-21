// Test-only bridge avoids importing Worker ambient types into the app compiler.
const workerPath = '../src/platform-whatsapp-audio.ts';
export const { handlePlatformAudioOutbound } = await import(workerPath);

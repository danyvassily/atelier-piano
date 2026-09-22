type AudioContextConstructor = typeof AudioContext;

interface SafariAudioWindow extends Window {
  webkitAudioContext?: AudioContextConstructor;
}

let sharedContext: AudioContext | null = null;

function audioContextConstructor(): AudioContextConstructor {
  const safariWindow = window as SafariAudioWindow;
  const Constructor = window.AudioContext || safariWindow.webkitAudioContext;
  if (!Constructor) throw new Error("La lecture audio n’est pas disponible dans ce navigateur.");
  return Constructor;
}

/**
 * Safari iOS attend un contexte créé et réveillé directement après un geste.
 * Le contexte reste donc partagé pendant toute la vie de la PWA.
 */
export function getSharedAudioContext(latencyHint: AudioContextLatencyCategory = "interactive"): AudioContext {
  if (!sharedContext || sharedContext.state === "closed") {
    const Constructor = audioContextConstructor();
    sharedContext = new Constructor({ latencyHint });
  }
  return sharedContext;
}

export async function unlockAudio(): Promise<AudioContext> {
  const context = getSharedAudioContext();
  if (context.state === "suspended") await context.resume();

  // Un tampon silencieux débloque la sortie des PWA iOS sans produire de clic.
  const source = context.createBufferSource();
  source.buffer = context.createBuffer(1, 1, context.sampleRate);
  source.connect(context.destination);
  source.start(0);
  return context;
}


import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons';
import { useBack } from './back';

/**
 * Reads a QR code with the camera. An app installed on the home screen needs
 * it: links tapped anywhere else open in the browser, never in the installed
 * app, which keeps its own storage. Hands back the first code that carries an
 * invite or a recovery link; the decoder loads only when the camera opens.
 */
export function Scan({ onText, onClose }: { onText: (text: string) => void; onClose: () => void }) {
  useBack(onClose);
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [other, setOther] = useState(false);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let done = false;
    const stop = () => {
      done = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach(t => t.stop());
    };
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
        const [{ default: jsQR }, s] = await Promise.all([import('jsqr'), navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })]);
        stream = s;
        if (done) return stop();
        const v = video.current!;
        v.srcObject = s;
        await v.play();
        let last = 0;
        const tick = (t: number) => {
          if (done) return;
          raf = requestAnimationFrame(tick);
          // a few frames a second is plenty, and spares the battery
          if (t - last < 120 || !v.videoWidth) return;
          last = t;
          const k = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
          canvas.width = Math.round(v.videoWidth * k);
          canvas.height = Math.round(v.videoHeight * k);
          ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
          const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, { inversionAttempts: 'dontInvert' });
          if (!code?.data) return;
          if (/(join|restore)=/.test(code.data)) {
            stop();
            onText(code.data);
          } else setOther(true);
        };
        raf = requestAnimationFrame(tick);
      } catch (e) {
        stop();
        const name = (e as { name?: string })?.name;
        setError(
          name === 'NotAllowedError'
            ? 'لم يُسمح باستخدام الكاميرا. اسمح بها للتطبيق من الإعدادات، أو ألصق الرابط بدلًا من ذلك.'
            : 'الكاميرا غير متاحة هنا. ألصق الرابط بدلًا من ذلك.',
        );
      }
    })();
    return stop;
  }, []);
  return (
    <div class="overlay full scan">
      <video ref={video} playsInline muted />
      <div class="frame" />
      <div class="scantop">
        <button class="round glass" onClick={onClose} aria-label="إغلاق">
          <Icon name="x" />
        </button>
      </div>
      <div class="scanmsg glass">
        {error ?? (other ? 'هذا الرمز ليس دعوة للعائلة. وجّه الكاميرا إلى رمز الدعوة.' : 'وجّه الكاميرا إلى رمز الدعوة أو رمز الاستعادة.')}
      </div>
    </div>
  );
}

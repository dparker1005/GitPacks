'use client';

import { useState, useRef, useEffect } from 'react';

export default function CardImage({
  src,
  alt,
  href,
}: {
  src: string;
  alt: string;
  href: string;
}) {
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Check if image is already cached/complete on mount
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoaded(true);
    }
  }, []);

  return (
    <a href={href} style={{ position: 'relative', display: 'inline-block' }}>
      {!loaded && (
        <div
          style={{
            width: '320px',
            height: '480px',
            maxWidth: '100%',
            borderRadius: '16px',
            background: 'rgba(30,30,60,0.6)',
            border: '1px solid #2a2a4a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: '36px',
              height: '36px',
              border: '3px solid #3a3a5a',
              borderTopColor: '#7873f5',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
            }}
          />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        width={320}
        height={480}
        onLoad={() => setLoaded(true)}
        style={{
          borderRadius: '16px',
          maxWidth: '100%',
          height: 'auto',
          display: loaded ? 'block' : 'none',
        }}
      />
    </a>
  );
}

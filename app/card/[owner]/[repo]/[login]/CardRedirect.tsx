'use client';

import { useEffect } from 'react';

export default function CardRedirect({ href }: { href: string }) {
  useEffect(() => {
    window.location.replace(href);
  }, [href]);

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          textAlign: 'center',
          fontFamily: 'Rajdhani, sans-serif',
          color: '#888',
        }}
      >
        <p>Redirecting to GitPacks...</p>
        <a href={href} style={{ color: '#4adede', fontSize: '0.85rem' }}>
          Click here if not redirected
        </a>
      </div>
    </div>
  );
}

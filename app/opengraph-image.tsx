import { ImageResponse } from 'next/og';

export const alt = 'Primero Galaxy — The AI Transformation Maturity Galaxy';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * Social-share image, rendered at build time from the design tokens:
 * void background, nebula glow, a cluster of maturity-colored stars and a
 * violet trajectory, plus the title. No binary assets to maintain.
 */
export default function OpengraphImage() {
  // [x, y, size, color]
  const stars: [number, number, number, string][] = [
    [180, 150, 7, '#4A4A6A'],
    [240, 420, 9, '#FF6B35'],
    [330, 240, 6, '#4A4A6A'],
    [410, 180, 12, '#F7C548'],
    [470, 470, 8, '#00D9C0'],
    [560, 120, 6, '#4A4A6A'],
    [620, 340, 10, '#FF6B35'],
    [700, 500, 7, '#F7C548'],
    [820, 170, 14, '#00D9C0'],
    [880, 420, 6, '#4A4A6A'],
    [950, 300, 9, '#F7C548'],
    [1030, 480, 7, '#4A4A6A'],
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '0 80px',
          backgroundColor: '#030308',
          position: 'relative',
        }}
      >
        {/* Nebula glow */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'radial-gradient(ellipse 62% 50% at 50% 46%, rgba(10,10,26,0.9) 0%, rgba(3,3,8,0) 68%)',
          }}
        />
        {/* Scattered stars */}
        {stars.map(([x, y, r, color]) => (
          <div
            key={`${x}-${y}`}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width: r,
              height: r,
              borderRadius: '9999px',
              backgroundColor: color,
            }}
          />
        ))}
        {/* Trajectory arc from the featured star toward the future */}
        <div
          style={{
            position: 'absolute',
            left: 812,
            top: 158,
            width: 200,
            height: 120,
            borderRadius: '9999px',
            borderTop: '4px solid rgba(123, 97, 255, 0.85)',
            transform: 'rotate(-12deg)',
          }}
        />
        <div
          style={{
            position: 'absolute',
            left: 996,
            top: 244,
            width: 14,
            height: 14,
            borderRadius: '9999px',
            backgroundColor: '#7B61FF',
            boxShadow: '0 0 24px rgba(123, 97, 255, 0.9)',
          }}
        />

        {/* Copy */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'Geist, system-ui, sans-serif',
          }}
        >
          <div
            style={{
              display: 'flex',
              fontSize: 28,
              fontWeight: 600,
              letterSpacing: '0.4em',
              color: '#7B61FF',
              marginBottom: 28,
            }}
          >
            PRIMERO GALAXY
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 88,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              lineHeight: 1.05,
              color: '#FFFFFF',
            }}
          >
            The AI Transformation
            <br />
            Galaxy
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 30,
              fontWeight: 400,
              letterSpacing: '0.05em',
              color: '#B0B0C8',
              marginTop: 32,
            }}
          >
            Fortune 500 enterprises. One universe. Explore.
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}

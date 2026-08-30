import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Badge, DevBadge } from '../components/ui';

describe('Badge', () => {
  it('renders children and default variant', () => {
    const html = renderToStaticMarkup(<Badge>Status</Badge>);
    expect(html).toContain('Status');
  });

  it('renders all variants', () => {
    for (const variant of [
      'default',
      'brand',
      'warning',
      'success',
      'danger',
      'info',
      'neutral',
    ] as const) {
      const html = renderToStaticMarkup(<Badge variant={variant}>{variant}</Badge>);
      expect(html).toContain(variant);
    }
  });

  it('renders pill and icon when provided', () => {
    const html = renderToStaticMarkup(
      <Badge pill icon={<span data-testid="icon">★</span>}>
        Pill Badge
      </Badge>
    );
    expect(html).toContain('Pill Badge');
    expect(html).toContain('★');
  });

  it('renders indicator dot with or without pulse', () => {
    const dotHtml = renderToStaticMarkup(<Badge dot>Dot</Badge>);
    const pulseHtml = renderToStaticMarkup(<Badge pulse>Pulse</Badge>);
    expect(dotHtml).toContain('aria-hidden="true"');
    expect(pulseHtml).toContain('aria-hidden="true"');
  });
});

describe('DevBadge', () => {
  it('renders badge markup when show is true', () => {
    const html = renderToStaticMarkup(<DevBadge show={true} />);
    expect(html).toContain('DEV');
    expect(html).toContain('data-testid="dev-badge"');
    expect(html).toContain('aria-label="Development build badge"');
  });

  it('renders null when show is false', () => {
    const html = renderToStaticMarkup(<DevBadge show={false} />);
    expect(html).toBe('');
  });

  it('renders custom label when provided', () => {
    const html = renderToStaticMarkup(<DevBadge show={true} label="CANARY" />);
    expect(html).toContain('CANARY');
    expect(html).not.toContain('>DEV<');
  });

  it('applies custom className and size styles', () => {
    const html = renderToStaticMarkup(<DevBadge show={true} size="sm" className="custom-class" />);
    expect(html).toContain('custom-class');
    expect(html).toContain('DEV');
  });

  it('toggles pulsing dot based on pulse prop', () => {
    const htmlWithPulse = renderToStaticMarkup(<DevBadge show={true} pulse={true} />);
    const htmlWithoutPulse = renderToStaticMarkup(<DevBadge show={true} pulse={false} />);

    expect(htmlWithPulse).toContain('aria-hidden="true"');
    expect(htmlWithoutPulse).not.toContain('aria-hidden="true"');
  });
});

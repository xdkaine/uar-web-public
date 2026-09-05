'use client';

import { RotateCcw } from 'lucide-react';

import PortalNav from '@/components/PortalNav';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DEFAULT_APPEARANCE_THEME, type AppearanceThemeConfig, type NavLinkConfig } from '@/lib/appearance';

interface AppearanceThemeSectionProps {
  links: NavLinkConfig[];
  theme: AppearanceThemeConfig;
  onThemeChange: (theme: AppearanceThemeConfig) => void;
}

export default function AppearanceThemeSection({ links, theme, onThemeChange }: AppearanceThemeSectionProps) {
  return (
    <Card id="portal-theme" className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <CardHeader><CardTitle>Portal theme tokens</CardTitle><CardDescription>Constrained presentation controls. Authentication, administrative controls, and functional state colors remain code-owned.</CardDescription></CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-[minmax(0,460px)_1fr]">
        <div className="space-y-4">
          <div className="space-y-1.5"><Label htmlFor="theme-logo">Logo asset path</Label><Input id="theme-logo" value={theme.logoUrl} onChange={(event) => onThemeChange({ ...theme, logoUrl: event.target.value })} /><p className="text-xs text-muted-foreground">Use an existing portal asset path. Remote images are not accepted.</p></div>
          <div className="space-y-1.5"><Label htmlFor="theme-accent">Brand accent</Label><div className="flex gap-2"><input id="theme-accent" type="color" value={theme.brandAccent} onChange={(event) => onThemeChange({ ...theme, brandAccent: event.target.value.toUpperCase() })} className="h-10 w-14 rounded border" /><Input value={theme.brandAccent} onChange={(event) => onThemeChange({ ...theme, brandAccent: event.target.value.toUpperCase() })} /></div></div>
          <div className="max-w-xs space-y-1.5"><Label htmlFor="theme-radius">Corner radius</Label><select id="theme-radius" className="w-full rounded-md border bg-background p-2 text-sm" value={theme.radius} onChange={(event) => onThemeChange({ ...theme, radius: event.target.value as AppearanceThemeConfig['radius'] })}><option value="compact">Compact</option><option value="standard">Standard</option><option value="soft">Soft</option></select><p className="text-xs text-muted-foreground">Applies to shared portal controls and cards.</p></div>
          <Button variant="outline" onClick={() => onThemeChange({ ...DEFAULT_APPEARANCE_THEME })}><RotateCcw className="mr-2 h-4 w-4" />Reset theme</Button>
        </div>
        <div className="overflow-hidden rounded-lg border"><div className="h-2" style={{ background: theme.brandAccent }} /><PortalNav links={links} sessionState="anonymous" interactive={false} logoUrl={theme.logoUrl} /><div className="space-y-3 p-6"><Badge style={{ background: theme.brandAccent, color: '#111827' }}>Brand anchor</Badge><h2 className="text-2xl font-bold">Operational portal surface</h2><p className="text-muted-foreground">Gold identifies the organization. Blue, teal, violet, and amber identify work. Red stays reserved for destructive and incident states.</p></div></div>
      </CardContent>
    </Card>
  );
}

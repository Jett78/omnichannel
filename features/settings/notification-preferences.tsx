"use client";

import { useState } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

const PREFERENCES = [
  {
    id: "assigned",
    label: "Conversation assigned to me",
    description: "Get notified when a teammate assigns you a conversation.",
    defaultOn: true,
  },
  {
    id: "mentioned",
    label: "Mentions in internal notes",
    description: "Get notified when someone @mentions you.",
    defaultOn: true,
  },
  {
    id: "unassigned",
    label: "Unassigned conversation waiting",
    description: "Daily summary of conversations nobody has picked up.",
    defaultOn: false,
  },
] as const;

/** UI preview only — persisting preferences arrives in a later phase. */
export function NotificationPreferences() {
  const [values, setValues] = useState<Record<string, boolean>>(
    Object.fromEntries(PREFERENCES.map((p) => [p.id, p.defaultOn])),
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification preferences</CardTitle>
        <CardDescription>
          Preferences UI preview — saving arrives in a later phase; toggles are not persisted yet.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col divide-y">
        {PREFERENCES.map((preference) => (
          <div key={preference.id} className="flex items-center justify-between gap-4 py-3">
            <div>
              <Label htmlFor={`pref-${preference.id}`}>{preference.label}</Label>
              <p className="text-muted-foreground text-xs">{preference.description}</p>
            </div>
            <Switch
              id={`pref-${preference.id}`}
              checked={values[preference.id] ?? false}
              onCheckedChange={(checked) =>
                setValues((prev) => ({ ...prev, [preference.id]: checked }))
              }
            />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

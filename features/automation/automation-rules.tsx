"use client";

import { Plus, Zap } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/layout/page-header";
import { SampleBadge } from "@/components/sample-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { SAMPLE_AUTOMATION_RULES } from "@/features/automation/sample-data";

export function AutomationRules() {
  const [rules, setRules] = useState(SAMPLE_AUTOMATION_RULES);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Automation"
        description="Rules that greet, route and escalate conversations automatically."
        actions={
          <>
            <SampleBadge />
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="size-4" /> New rule
            </Button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {rules.map((rule) => (
          <Card key={rule.id} className="shadow-none">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="bg-accent text-primary flex size-9 items-center justify-center rounded-lg">
                    <Zap className="size-4" />
                  </span>
                  <div>
                    <CardTitle className="text-base">{rule.name}</CardTitle>
                    <CardDescription>{rule.runsLabel}</CardDescription>
                  </div>
                </div>
                <Switch
                  checked={rule.enabled}
                  onCheckedChange={(checked) =>
                    setRules((prev) =>
                      prev.map((r) => (r.id === rule.id ? { ...r, enabled: checked } : r)),
                    )
                  }
                  aria-label={`Enable sample rule ${rule.name}`}
                />
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-sm">
              <p>
                <span className="text-muted-foreground">When: </span>
                {rule.trigger}
              </p>
              <p>
                <span className="text-muted-foreground">Then: </span>
                {rule.action}
              </p>
              <Badge variant={rule.enabled ? "success" : "muted"} className="w-fit">
                {rule.enabled ? "Enabled (preview)" : "Disabled"}
              </Badge>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Automation builder</DialogTitle>
            <DialogDescription>
              The rule builder arrives after channels are connected (Phase 7 in the Phase 0 plan) —
              automations need live conversations to trigger on. The rules on this page are sample
              previews; toggling them changes nothing outside this screen.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  );
}

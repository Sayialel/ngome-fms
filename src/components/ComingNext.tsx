import { Card, CardContent } from '@/components/ui/card';

/** Placeholder for a section that arrives in a later build phase. */
export default function ComingNext({ phase, items }: { phase: string; items: string[] }) {
  return (
    <Card className="border-dashed">
      <CardContent className="pt-6">
        <p className="text-sm font-medium">Arrives in {phase}</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

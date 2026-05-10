import { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/Card";
import { Hammer } from "lucide-react";

// Generic "under construction" card. Kept around for any future page that
// needs a visible stub before its real implementation lands.
interface PlaceholderProps {
  title: string;
  description: string;
  comingSoon: ReactNode;
}

export function Placeholder({ title, description, comingSoon }: PlaceholderProps) {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground">{description}</p>
      </header>

      <Card>
        <CardContent className="py-12 flex flex-col items-center text-center gap-3">
          <div className="h-12 w-12 rounded-full bg-accent flex items-center justify-center">
            <Hammer className="h-6 w-6 text-accent-foreground" />
          </div>
          <div>
            <p className="font-medium">Under construction</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md">{comingSoon}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

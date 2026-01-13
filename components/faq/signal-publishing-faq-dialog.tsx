'use client';

import { HelpCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import faq from '@/shared/faq/how_signals_are_generated_and_published.json';

type FaqItem = {
  question: string;
  answer: string;
};

type FaqDefinition = {
  title: string;
  inline_microcopy: string;
  items: FaqItem[];
};

const typedFaq = faq as FaqDefinition;

export function SignalPublishingFaqDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center justify-center rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="How signals are generated and published"
          title="How signals are generated and published"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{typedFaq.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground whitespace-pre-line">
            {typedFaq.inline_microcopy}
          </p>

          <div className="space-y-4">
            {typedFaq.items.map((item, idx) => (
              <div key={idx} className="space-y-1">
                <h3 className="text-sm font-semibold text-foreground">{item.question}</h3>
                <p className="text-sm text-muted-foreground">{item.answer}</p>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function SignalPublishingFaqMicrocopy({ className }: { className?: string }) {
  return (
    <p className={cn('text-sm text-muted-foreground whitespace-pre-line', className)}>
      {typedFaq.inline_microcopy}
    </p>
  );
}

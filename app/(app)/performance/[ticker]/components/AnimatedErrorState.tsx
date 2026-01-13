'use client';

import { motion } from 'framer-motion';
import { AlertCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface AnimatedErrorStateProps {
  message: string;
  onRetry: () => void;
}

export default function AnimatedErrorState({ message, onRetry }: AnimatedErrorStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
    >
      <Card className="border-red-200 bg-red-50/50">
        <CardContent className="pt-8 pb-8">
          <div className="flex flex-col items-center justify-center text-center space-y-4">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 200 }}
            >
              <AlertCircle className="w-12 h-12 text-red-500" />
            </motion.div>

            <div className="space-y-2">
              <h3 className="text-lg font-semibold text-gray-900">Unable to load performance data</h3>
              <p className="text-sm text-gray-600 max-w-md">{message}</p>
            </div>

            <Button
              onClick={onRetry}
              variant="outline"
              className="border-red-300 text-red-700 hover:bg-red-100"
            >
              Try again
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

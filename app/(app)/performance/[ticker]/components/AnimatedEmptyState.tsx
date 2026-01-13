'use client';

import { motion } from 'framer-motion';
import { BarChart3 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface AnimatedEmptyStateProps {
  message: string;
}

export default function AnimatedEmptyState({ message }: AnimatedEmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="border-gray-200">
        <CardContent className="pt-12 pb-12">
          <div className="flex flex-col items-center justify-center text-center space-y-4">
            <motion.div
              animate={{
                y: [0, -8, 0],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: 'easeInOut',
              }}
            >
              <BarChart3 className="w-16 h-16 text-gray-300" />
            </motion.div>

            <div className="space-y-1">
              <h3 className="text-base font-semibold text-gray-900">No data available</h3>
              <p className="text-sm text-gray-600 max-w-md">{message}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

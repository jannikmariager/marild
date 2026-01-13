'use client';

import { Sparkles } from 'lucide-react';

export default function AskAiButton() {
  const handleClick = () => {
    // TODO: Navigate to AI chat when implemented
    console.log('AI Chat not yet implemented');
  };

  return (
    <button
      onClick={handleClick}
      className="w-full mt-4 bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white font-semibold py-4 px-6 rounded-lg shadow-lg transition-all flex items-center justify-center gap-3"
    >
      <Sparkles className="w-5 h-5" />
      <span>Ask AI Anything</span>
    </button>
  );
}

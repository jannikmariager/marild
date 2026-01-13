import { Topbar } from '@/components/layout/topbar';
import { NewsFeed } from '@/components/news/news-feed';

export default function NewsPage() {
  return (
    <div>
      <Topbar title="News" />
      <div className="p-6">
        <NewsFeed />
      </div>
    </div>
  );
}

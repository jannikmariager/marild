import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { FileText, PlusCircle, Edit, Trash2 } from 'lucide-react'
import { KPITile } from '@/components/admin/kpi-tile'

export default function ContentPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Content Management</h1>
          <p className="text-muted-foreground mt-1">Manage blog posts, changelogs, and announcements</p>
        </div>
        <Button className="bg-emerald-600 hover:bg-emerald-700">
          <PlusCircle className="h-4 w-4 mr-2" />
          New Post
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <KPITile title="Blog Posts" value="24" icon={FileText} />
        <KPITile title="Changelogs" value="67" icon={FileText} />
        <KPITile title="Announcements" value="12" icon={FileText} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent Content</CardTitle>
          <CardDescription>Latest blog posts and announcements</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[
              { title: 'New SMC Features Released', type: 'Blog Post', date: '2 days ago' },
              { title: 'v2.1.0 Update', type: 'Changelog', date: '5 days ago' },
              { title: 'System Maintenance Notice', type: 'Announcement', date: '1 week ago' },
            ].map((item, i) => (
              <div
                key={i}
                className="flex items-center justify-between p-4 bg-muted rounded-lg"
              >
                <div>
                  <h3 className="text-foreground font-medium">{item.title}</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {item.type} · {item.date}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" className="text-blue-400">
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="sm" className="text-red-400">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

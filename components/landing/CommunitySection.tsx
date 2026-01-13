"use client";

import { Card } from "@/components/ui/card";
import { MessageCircle, Smartphone, ArrowRight } from "lucide-react";
import Link from "next/link";

const signalChannels = [
  {
    name: "Mobile App",
    icon: Smartphone,
    description: "Get signals on iOS & Android",
    href: "/signup",
    color: "from-emerald-500 to-emerald-400",
  },
  {
    name: "Discord",
    icon: MessageCircle,
    description: "Real-time signal alerts",
    href: "https://discord.gg/tradelens",
    color: "from-indigo-500 to-indigo-400",
  },
];

export function CommunitySection() {
  return (
    <section className="py-24 relative">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-4xl lg:text-5xl font-bold mb-4">
            Get Marild Signals
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Receive AI-powered trading signals directly in our mobile app and on Discord
          </p>
        </div>
        
        <div className="grid md:grid-cols-2 gap-6 max-w-4xl mx-auto">
          {signalChannels.map((channel, index) => {
            const Icon = channel.icon;
            return (
              <Link key={channel.name} href={channel.href} target={channel.name === "Discord" ? "_blank" : undefined} rel={channel.name === "Discord" ? "noopener noreferrer" : undefined}>
                <Card
                  className="group relative overflow-hidden p-8 border-border/50 hover:border-border transition-all duration-300 hover:shadow-xl hover:-translate-y-1 cursor-pointer h-full"
                  style={{
                    animation: `fadeInUp 0.6s ease-out ${index * 0.1}s both`,
                  }}
                >
                  <div className="relative z-10">
                    <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${channel.color} p-4 mb-6 group-hover:scale-110 transition-transform duration-300`}>
                      <Icon className="w-full h-full text-white" />
                    </div>
                    <h3 className="text-2xl font-semibold mb-3">{channel.name}</h3>
                    <p className="text-base text-muted-foreground">{channel.description}</p>
                    
                    <div className="mt-6 flex items-center gap-2 text-sm font-medium text-emerald-500 group-hover:gap-3 transition-all">
                      Get started
                      <ArrowRight className="w-4 h-4" />
                    </div>
                  </div>
                  
                  {/* Hover gradient effect */}
                  <div className={`absolute inset-0 bg-gradient-to-br ${channel.color} opacity-0 group-hover:opacity-5 transition-opacity duration-300 pointer-events-none`} />
                </Card>
              </Link>
            );
          })}
        </div>
        
        <div className="text-center mt-12">
          <p className="text-muted-foreground">
            All signals included with your Pro subscription
          </p>
        </div>
      </div>
    </section>
  );
}

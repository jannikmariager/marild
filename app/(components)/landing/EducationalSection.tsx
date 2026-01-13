"use client";

import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { educationalSlides } from "@/lib/mockData";

export function EducationalSection() {
  const [currentSlide, setCurrentSlide] = useState(0);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % educationalSlides.length);
    }, 5000);
    
    return () => clearInterval(interval);
  }, []);
  
  const goToSlide = (index: number) => {
    setCurrentSlide(index);
  };
  
  const nextSlide = () => {
    setCurrentSlide((prev) => (prev + 1) % educationalSlides.length);
  };
  
  const prevSlide = () => {
    setCurrentSlide((prev) => (prev - 1 + educationalSlides.length) % educationalSlides.length);
  };
  
  return (
    <section className="py-24 relative">
      <div className="container mx-auto px-4">
        <div className="text-center mb-16">
          <h2 className="text-4xl lg:text-5xl font-bold mb-4">
            How We Actually Trade
          </h2>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Full transparency into our Live Model Portfolio rules and methodology
          </p>
        </div>
        
        <div className="max-w-4xl mx-auto">
          <Card className="relative overflow-hidden border-border/50 bg-card backdrop-blur-sm">
            {/* Slides container */}
            <div className="relative h-[400px] overflow-hidden">
              {educationalSlides.map((slide, index) => (
                <div
                  key={slide.title}
                  className={`absolute inset-0 p-12 transition-all duration-500 ${
                    index === currentSlide
                      ? "opacity-100 translate-x-0"
                      : index < currentSlide
                      ? "opacity-0 -translate-x-full"
                      : "opacity-0 translate-x-full"
                  }`}
                >
                  <div className="flex flex-col justify-center h-full px-0 sm:px-4 lg:px-8">
                    <h3 className="text-3xl font-bold mb-8">{slide.title}</h3>
                    <ul className="space-y-4 pl-1 sm:pl-4">
                      {slide.content.map((item, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-3 text-lg"
                          style={{
                            animation: index === currentSlide ? `fadeInUp 0.5s ease-out ${i * 0.1}s both` : "none",
                          }}
                        >
                          <div className="mt-2 flex-shrink-0 w-2 h-2 rounded-full bg-emerald-500" />
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
            
            {/* Navigation arrows */}
            <div className="absolute top-1/2 -translate-y-1/2 left-4 right-4 flex justify-between pointer-events-none">
              <Button
                variant="ghost"
                size="icon"
                onClick={prevSlide}
                className="pointer-events-auto bg-background/80 hover:bg-background border border-border/50"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={nextSlide}
                className="pointer-events-auto bg-background/80 hover:bg-background border border-border/50"
              >
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>
            
            {/* Dots indicator */}
            <div className="absolute bottom-6 left-0 right-0 flex justify-center gap-2">
              {educationalSlides.map((_, index) => (
                <button
                  key={index}
                  onClick={() => goToSlide(index)}
                  className={`w-2 h-2 rounded-full transition-all duration-300 ${
                    index === currentSlide
                      ? "bg-emerald-500 w-8"
                      : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                  }`}
                />
              ))}
            </div>
          </Card>
          
          <div className="text-center mt-8">
            <p className="text-sm text-muted-foreground">
              Slide {currentSlide + 1} of {educationalSlides.length} • Auto-advancing
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

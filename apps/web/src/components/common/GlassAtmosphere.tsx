import React from 'react';

export const GlassAtmosphere: React.FC = () => {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden" aria-hidden="true">
      {/* Mint glow top-left */}
      <div 
        className="absolute -top-[12%] -left-[8%] w-[60vw] h-[60vw] max-w-[800px] max-h-[800px] rounded-full opacity-60 filter blur-[90px]"
        style={{ background: 'radial-gradient(circle, #7AFFA1 0%, rgba(122,255,161,0.35) 45%, transparent 70%)' }}
      />

      {/* Lavender glow center-right */}
      <div 
        className="absolute top-[18%] -right-[10%] w-[55vw] h-[55vw] max-w-[750px] max-h-[750px] rounded-full opacity-55 filter blur-[100px]"
        style={{ background: 'radial-gradient(circle, #DDCBF5 0%, rgba(221,203,245,0.4) 45%, transparent 70%)' }}
      />

      {/* Butter yellow glow top-center */}
      <div 
        className="absolute -top-[5%] right-[28%] w-[45vw] h-[45vw] max-w-[600px] max-h-[600px] rounded-full opacity-50 filter blur-[95px]"
        style={{ background: 'radial-gradient(circle, #FFF87C 0%, rgba(255,248,124,0.35) 45%, transparent 70%)' }}
      />

      {/* Soft Peach coral glow bottom-left */}
      <div 
        className="absolute bottom-[2%] left-[8%] w-[50vw] h-[50vw] max-w-[650px] max-h-[650px] rounded-full opacity-45 filter blur-[100px]"
        style={{ background: 'radial-gradient(circle, #FFA27D 0%, rgba(255,162,125,0.3) 45%, transparent 70%)' }}
      />

      {/* Sky cyan glow bottom-right */}
      <div 
        className="absolute -bottom-[8%] right-[8%] w-[52vw] h-[52vw] max-w-[700px] max-h-[700px] rounded-full opacity-55 filter blur-[100px]"
        style={{ background: 'radial-gradient(circle, #BAE6FD 0%, rgba(186,230,253,0.35) 45%, transparent 70%)' }}
      />
    </div>
  );
};

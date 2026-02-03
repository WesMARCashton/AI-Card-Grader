
import React, { useState, useRef, useCallback, ChangeEvent, useEffect } from 'react';
import { useCamera } from '../hooks/useCamera';
import { fileToDataUrl } from '../utils/fileUtils';
import { CameraIcon, UploadIcon, SpinnerIcon, CheckIcon, ResyncIcon } from './icons';

interface CardScannerProps {
  onRatingRequest: (front: string, back: string) => void;
  isGrading: boolean;
  gradingStatus?: string;
  isLoggedIn: boolean;
  hasCards: boolean;
  onSyncDrive: () => void;
  isSyncing: boolean;
}

type ScanMode = 'upload' | 'camera';
type TargetSide = 'front' | 'back';

export const CardScanner: React.FC<CardScannerProps> = ({ 
  onRatingRequest, 
  isGrading, 
  gradingStatus, 
  isLoggedIn, 
  hasCards, 
  onSyncDrive,
  isSyncing
}) => {
  const [frontImage, setFrontImage] = useState<string | null>(null);
  const [backImage, setBackImage] = useState<string | null>(null);
  const [scanMode, setScanMode] = useState<ScanMode>('upload');
  const [cameraTarget, setCameraTarget] = useState<TargetSide>('front');
  const [confirmation, setConfirmation] = useState('');
  
  const { videoRef, stream, startCamera, stopCamera, capturePhoto, error: cameraError } = useCamera();

  const fileInputFrontRef = useRef<HTMLInputElement>(null);
  const fileInputBackRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (confirmation) {
      timer = setTimeout(() => {
        setConfirmation('');
      }, 3000);
    }
    return () => clearTimeout(timer);
  }, [confirmation]);

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>, side: TargetSide) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const dataUrl = await fileToDataUrl(file);
      if (side === 'front') {
        setFrontImage(dataUrl);
      } else {
        setBackImage(dataUrl);
      }
    }
  };

  const handleCapture = () => {
    const photoDataUrl = capturePhoto();
    if (photoDataUrl) {
      if (cameraTarget === 'front') {
        setFrontImage(photoDataUrl);
        setCameraTarget('back');
      } else {
        setBackImage(photoDataUrl);
        stopCamera();
      }
    }
  };
  
  const handleStartCamera = () => {
    setScanMode('camera');
    setCameraTarget('front');
    startCamera();
  }

  const handleSwitchToUpload = () => {
    stopCamera();
    setScanMode('upload');
  }

  const handleGetRating = () => {
    if (frontImage && backImage) {
      onRatingRequest(frontImage, backImage);
      setFrontImage(null);
      setBackImage(null);
      setConfirmation('Card added to collection!');
    }
  };
  
  const renderImageSlot = (side: TargetSide, image: string | null, fileRef: React.RefObject<HTMLInputElement>) => (
    <div 
      className="relative w-full aspect-[2.5/3.5] bg-slate-100/80 border-2 border-dashed border-slate-400 rounded-lg flex flex-col justify-center items-center text-slate-500 cursor-pointer hover:border-blue-500 hover:bg-slate-200/80 transition-all duration-300 group"
      onClick={() => fileRef.current?.click()}
    >
      {image ? (
        <img src={image} alt={`${side} of card`} className="absolute inset-0 w-full h-full object-contain rounded-lg" />
      ) : (
        <>
          <UploadIcon className="h-10 w-10 mb-2 group-hover:text-blue-500 transition-colors" />
          <span className="text-sm font-semibold">Click to upload {side}</span>
        </>
      )}
      <input type="file" accept="image/*" ref={fileRef} onChange={(e) => handleFileChange(e, side)} className="hidden" />
    </div>
  );

  return (
    <div className="w-full max-w-md mx-auto p-4 md:p-6 space-y-6 animate-fade-in">
      {isLoggedIn && !hasCards && (
        <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl text-center space-y-3 shadow-sm">
           <p className="text-sm text-blue-800 font-medium italic">Collection not loaded.</p>
           <button 
              onClick={onSyncDrive}
              disabled={isSyncing}
              className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg transition-all shadow-md disabled:opacity-50"
           >
              {isSyncing ? <SpinnerIcon className="w-5 h-5" /> : <ResyncIcon className="w-5 h-5" />}
              {isSyncing ? 'Syncing...' : 'Load from Drive'}
           </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        {renderImageSlot('front', frontImage, fileInputFrontRef)}
        {renderImageSlot('back', backImage, fileInputBackRef)}
      </div>

      {!stream && (
        <button
          onClick={handleStartCamera}
          className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-white/70 hover:bg-white text-slate-800 font-semibold rounded-lg shadow-md transition-transform transform hover:scale-[1.02] border border-slate-300"
        >
          <CameraIcon className="h-6 w-6 text-blue-500" />
          <span>Scan with Camera</span>
        </button>
      )}

      {stream && (
        <div className="space-y-4">
            <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden border-2 border-slate-800 shadow-xl">
                <video ref={videoRef} autoPlay playsInline className="w-full h-full object-contain"></video>
                <div className="absolute inset-0 border-4 border-blue-500/30 rounded-lg pointer-events-none"></div>
            </div>
            {cameraError && <p className="text-red-500 text-center text-sm">{cameraError}</p>}
            <p className="text-center font-bold text-blue-600 animate-pulse">Position {cameraTarget} of card</p>
            <div className="flex gap-4">
                <button onClick={handleCapture} className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow-lg">
                    Capture {cameraTarget}
                </button>
                <button onClick={handleSwitchToUpload} className="py-3 px-4 bg-slate-500 hover:bg-slate-600 text-white font-bold rounded-lg shadow-md">
                    Cancel
                </button>
            </div>
        </div>
      )}
      
      <div className="space-y-4 pt-4">
        {confirmation && (
          <div className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-green-100 text-green-800 font-bold rounded-lg text-center animate-bounce shadow-sm">
            <CheckIcon className="w-6 h-6" />
            <span>{confirmation}</span>
          </div>
        )}
        
        <button
          onClick={handleGetRating}
          disabled={!frontImage || !backImage || isGrading}
          className="w-full py-4 px-4 bg-gradient-to-r from-[#3e85c7] to-[#ffcb05] text-white text-lg font-bold rounded-lg shadow-lg transition-all transform hover:scale-[1.02] active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100 flex items-center justify-center gap-3"
        >
          {isGrading ? (
            <>
              <SpinnerIcon className="w-6 h-6" />
              <span>{gradingStatus || 'Processing...'}</span>
            </>
          ) : 'Identify & Grade Card'}
        </button>
        <p className="text-center text-[10px] text-slate-400 uppercase tracking-widest font-bold">Standard NGA Grading Applied</p>
      </div>
    </div>
  );
};

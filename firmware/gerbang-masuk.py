from ultralytics import YOLO
from picamera2 import Picamera2
from insightface.app import FaceAnalysis
from fast_plate_ocr import LicensePlateRecognizer
from flask import Flask, Response
import gpiozero
import threading
import logging
import numpy as np
import cv2
import requests
import json
import time

# --- Hardware Setup ---
ir_sensor = gpiozero.Button(17, pull_up=True)
relay = gpiozero.OutputDevice(23, active_high=False)
relay.off()

# --- Models ---
print("Loading models untuk Gate Masuk...")
yolo_model = YOLO('runs/detect/train/weights/best.pt')
app = FaceAnalysis(name="buffalo_s")
app.prepare(ctx_id=-1)  # CPU Mode
ocr_model = LicensePlateRecognizer('cct-xs-v1-global-model')

# --- Inisialisasi PiCamera2 (Module V3) ---
picam2 = Picamera2()
picam2.configure(picam2.create_video_configuration(main={'format': 'RGB888', 'size': (960, 720)}))
picam2.start()

# --- Streaming Globals & Lock ---
latest_encoded_frame = None
frame_lock = threading.Lock()

app_flask = Flask(__name__)
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

# --- Control Variables ---
status = "SCANNING" 
hasil_akhir = []
response_status_code = 200
plate_number = ""

STABLE_THRESHOLD = 5
stable_counter = 0

error_start_time = 0
wait_start_time = 0  # Timer khusus WAITING_EXIT

# base_url = "https://apiparkir.zabduziz.com"
base_url = "http://100.98.50.107:3000"
url = f"{base_url}/detection"

# Kuantisasi kualitas JPEG (Default OpenCV itu 95, kita pangkas ke 50 biar hemat RAM)
JPEG_PARAMS = [int(cv2.IMWRITE_JPEG_QUALITY), 50]
LAST_STREAM_TIME = 0
STREAM_INTERVAL = 1.0 / 15.0  # Limit Flask Stream ke Max 15 FPS

print("Sistem Gate Masuk Ready (PiCam V3). Mode SCANNING Aktif...")

# --- Generator Stream untuk Frontend Vue ---
def generate_stream():
    global latest_encoded_frame
    while True:
        encoded_frame = None
        with frame_lock:
            if latest_encoded_frame is not None:
                encoded_frame = latest_encoded_frame.tobytes()

        if encoded_frame is not None:
            yield (
                b'--frame\r\n'
                b'Content-Type: image/jpeg\r\n\r\n' + 
                encoded_frame + 
                b'\r\n'
            )
        time.sleep(0.06)  # Jeda ~15 FPS di thread Flask

@app_flask.route('/stream')
def stream():
    return Response(generate_stream(), mimetype='multipart/x-mixed-replace; boundary=frame')

def run_flask():
    app_flask.run(host='0.0.0.0', port=5000, threaded=True, debug=False, use_reloader=False)

threading.Thread(target=run_flask, daemon=True).start()

try:
    while True:
        frame_rgb = picam2.capture_array()
        display_frame = frame_rgb.copy()
        ir_active = ir_sensor.is_pressed

        # ==========================================
        # STATE 1: SCANNING
        # ==========================================
        if status == "SCANNING":
            cv2.putText(display_frame, "SCANNING: Mencari Wajah & Plat...", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 0), 2)

            results = yolo_model(display_frame, conf=0.6, verbose=False)
            detections = {0: None, 1: None}

            for r in results:
                for box in r.boxes:
                    cls_id = int(box.cls[0])
                    if cls_id in detections:
                        detections[cls_id] = list(map(int, box.xyxy[0]))

            # DRAW BOUNDING BOXES (Cyan & Orange)
            if detections[0] is not None:
                xw1, yw1, xw2, yw2 = detections[0]
                cv2.rectangle(display_frame, (xw1, yw1), (xw2, yw2), (255, 255, 0), 2)
                cv2.putText(display_frame, "Wajah", (xw1, max(15, yw1 - 10)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 0), 2)

            if detections[1] is not None:
                xp1, yp1, xp2, yp2 = detections[1]
                cv2.rectangle(display_frame, (xp1, yp1), (xp2, yp2), (0, 165, 255), 2)
                cv2.putText(display_frame, "Plat Nomor", (xp1, max(15, yp1 - 10)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 165, 255), 2)

            if detections[0] is not None and detections[1] is not None:
                stable_counter += 1
                cv2.putText(display_frame, f"Stabilizing: {stable_counter}/{STABLE_THRESHOLD}", (10, 60),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 255), 2)

                if stable_counter >= STABLE_THRESHOLD:
                    print("Posisi Stabil! Mengeksekusi InsightFace & FastPlateOCR...")

                    xw, yw, xw2, yw2 = detections[0]
                    crop_face_rgb = frame_rgb[yw:yw2, xw:xw2]
                    
                    if crop_face_rgb.size == 0:
                        stable_counter = 0
                        continue

                    faces = app.get(crop_face_rgb)

                    if faces:
                        face_embed = faces[0].normed_embedding
                        hasil_akhir = ["Wajah: Terverifikasi"]
                    else:
                        print("Wajah terdeteksi YOLO tapi gagal diproses InsightFace.")
                        stable_counter = 0
                        continue

                    xp, yp, xp2, yp2 = detections[1]
                    crop_plate_bgr = display_frame[yp:yp2, xp:xp2]

                    if crop_plate_bgr.size == 0:
                        stable_counter = 0
                        continue

                    plate_res = ocr_model.run(crop_plate_bgr, return_confidence=True)

                    if plate_res:
                        plate_number = plate_res[0].plate
                        overall_conf = float(np.mean(plate_res[0].char_probs))
                        hasil_akhir.append(f"Plat: {plate_number}")
                    else:
                        print("Gagal membaca plat nomor.")
                        stable_counter = 0
                        continue

                    _, img_encoded = cv2.imencode('.jpg', display_frame)
                    data = {
                        "platNomor": plate_number,
                        "faceEmbedding": json.dumps(face_embed.tolist()),
                        "userId": 2,
                        "confidencePlat": overall_conf
                    }
                    files = {
                        "gambar": ("capture.jpg", img_encoded.tobytes(), "image/jpeg")
                    }

                    try:
                        print("Mengirim data masuk ke backend...")
                        response = requests.post(url, data=data, files=files, timeout=7)
                        response_status_code = response.status_code

                        if response_status_code in (200, 201):
                            print("Scan Sukses! Mengirim Trigger Pulsa ke Relay Gerbang...")
                            relay.on()
                            time.sleep(0.5)
                            relay.off()
                            
                            status = "WAITING_EXIT"
                            wait_start_time = time.time()  # Start timer jeda
                        else:
                            status = "COOLDOWN_ERROR"
                            error_start_time = time.time()

                    except requests.exceptions.RequestException as e:
                        print("Error koneksi ke backend:", e)
                        status = "COOLDOWN_ERROR"
                        error_start_time = time.time()
                        response_status_code = 500

                    stable_counter = 0
            else:
                stable_counter = 0
                if detections[0] is None and detections[1] is not None:
                    cv2.putText(display_frame, "Wajah Belum Terlihat", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
                elif detections[1] is None and detections[0] is not None:
                    cv2.putText(display_frame, "Plat Belum Terlihat", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)

        # ==========================================
        # STATE 2: COOLDOWN ERROR
        # ==========================================
        elif status == "COOLDOWN_ERROR":
            cv2.rectangle(display_frame, (50, 150), (750, 450), (0, 0, 0), -1)
            
            if response_status_code == 400:
                cv2.putText(display_frame, f"{plate_number} MASIH TERPARKIR!", (70, 250), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 0, 255), 2)
            else:
                cv2.putText(display_frame, "GAGAL / SERVER ERROR", (120, 250), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 0, 255), 2)

            time_left = max(0, 3 - int(time.time() - error_start_time))
            cv2.putText(display_frame, f"Reset otomatis dalam {time_left} detik...", (100, 350),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 1)

            if time.time() - error_start_time >= 3:
                status = "SCANNING"
                hasil_akhir = []

        # ==========================================
        # STATE 3: WAITING EXIT (Logic Timer 2s Delay & 5s Fallback)
        # ==========================================
        elif status == "WAITING_EXIT":
            elapsed_wait = time.time() - wait_start_time

            cv2.rectangle(display_frame, (50, 150), (750, 450), (0, 0, 0), -1)
            cv2.putText(display_frame, "DATA BERHASIL DIKIRIM", (140, 200), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)

            for i, line in enumerate(hasil_akhir):
                cv2.putText(display_frame, line, (70, 260 + i*40), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)

            cv2.putText(display_frame, "Silakan Masuk (Menunggu Lewat Gerbang)...", (80, 400),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)

            # Hanya baca IR jika SUDAH LEWAT 2 detik jeda awal
            if elapsed_wait >= 2.0 and ir_active:
                print("IR Sensor Triggered! Kembali ke SCANNING...")
                status = "SCANNING"
                hasil_akhir = []

            # Backup Timeout 5 detik jika IR tidak membaca sama sekali
            elif elapsed_wait >= 5.0:
                print("Timeout 5s tercapai (IR tidak terbaca). Reset ke SCANNING...")
                status = "SCANNING"
                hasil_akhir = []

        # --- UPDATE BUFFER FLASK STREAM (OPTIMIZED) ---
        current_time = time.time()
        if current_time - LAST_STREAM_TIME >= STREAM_INTERVAL:
            LAST_STREAM_TIME = current_time
            
            # Resize khusus untuk stream web biar ringan di RAM & Network
            stream_frame = cv2.resize(display_frame, (480, 360), interpolation=cv2.INTER_NEAREST)
            
            # Encode JPEG dengan kompresi kualitas 50%
            _, stream_buf = cv2.imencode('.jpg', stream_frame, JPEG_PARAMS)
            
            with frame_lock:
                latest_encoded_frame = stream_buf

        cv2.imshow("Gate Masuk - Smart Parking", display_frame)

        if cv2.waitKey(1) & 0xFF == ord('q'):
            break

finally:
    print("Cleaning up resources...")
    relay.off()
    picam2.stop()
    cv2.destroyAllWindows()

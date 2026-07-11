FROM python:3.11-slim

WORKDIR /app

COPY cloudrun-flask/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend_core.py .
COPY cloudrun-flask/app.py .

ENV PORT=80
EXPOSE 80

CMD ["gunicorn", "-b", "0.0.0.0:80", "app:app"]

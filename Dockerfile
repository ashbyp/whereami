FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml README.md ./
COPY backend ./backend
COPY frontend ./frontend

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir .

RUN mkdir -p /app/data/uploads

EXPOSE 8766

CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8766"]

FROM python:3.11-slim

# Install system dependencies for common Python packages
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    g++ \
    make \
    libffi-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Create pip cache directory
RUN mkdir -p /root/.cache/pip
VOLUME /root/.cache/pip

# Upgrade pip
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Pre-install common packages
RUN pip install --no-cache-dir \
    numpy \
    pandas \
    requests \
    python-dateutil \
    pytz

# Create workspace
RUN mkdir -p /workspace
WORKDIR /workspace

# Set Python to unbuffered mode
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1

# Create non-root user for security
RUN useradd -m -u 1000 -s /bin/bash sandbox
USER sandbox

CMD ["python"]

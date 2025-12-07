# MCP Sandbox - Python ML Runtime
# Optimized for Apple Silicon (M1/M2/M3/M4) and data science workloads

FROM python:3.11-slim

LABEL maintainer="MCP Sandbox"
LABEL description="Python ML runtime with numpy, pandas, sklearn, torch, mlx"

# Install system dependencies for ML workloads
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    gfortran \
    libopenblas-dev \
    liblapack-dev \
    pkg-config \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create non-root user for security
RUN groupadd -g 1000 sandbox && \
    useradd -u 1000 -g sandbox -m -s /bin/bash sandbox

# Create workspace and cache directories
RUN mkdir -p /workspace /home/sandbox/.cache/pip && \
    chown -R sandbox:sandbox /workspace /home/sandbox/.cache

# Upgrade pip and install build tools
RUN pip install --no-cache-dir --upgrade pip setuptools wheel

# Install core data science packages
RUN pip install --no-cache-dir \
    numpy==1.26.* \
    pandas==2.1.* \
    scipy==1.11.* \
    scikit-learn==1.3.* \
    matplotlib==3.8.* \
    seaborn==0.13.* \
    pillow==10.* \
    tqdm==4.* \
    rich==13.* \
    joblib==1.*

# Install PyTorch (CPU version - GPU requires native execution)
RUN pip install --no-cache-dir \
    torch --index-url https://download.pytorch.org/whl/cpu

# Install MLX (Apple Silicon ML framework)
# Will work on ARM64, gracefully fails on x86
RUN pip install --no-cache-dir mlx mlx-lm || echo "MLX requires Apple Silicon"

# Install HuggingFace ecosystem
RUN pip install --no-cache-dir \
    transformers==4.* \
    datasets==2.* \
    tokenizers==0.* \
    huggingface-hub==0.*

# Install additional ML utilities
RUN pip install --no-cache-dir \
    xgboost \
    lightgbm \
    statsmodels \
    && rm -rf /root/.cache/pip/*

# Environment configuration
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONIOENCODING=utf-8

# Optimize for ML workloads
ENV OMP_NUM_THREADS=4
ENV MKL_NUM_THREADS=4
ENV OPENBLAS_NUM_THREADS=4

# Disable telemetry
ENV HF_HUB_DISABLE_TELEMETRY=1

# Set working directory
WORKDIR /workspace

# Switch to non-root user
USER sandbox

# Default command
CMD ["python"]

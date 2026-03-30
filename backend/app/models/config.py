from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean
from datetime import datetime
from app.database import Base


class SystemConfig(Base):
    __tablename__ = "system_config"

    id = Column(Integer, primary_key=True, index=True)
    config_key = Column(String(50), unique=True, nullable=False, index=True)
    config_value = Column(Text)
    config_type = Column(String(20), default="string")  # string, number, boolean, json
    category = Column(String(30))  # scan, proxy, api, log
    is_public = Column(Boolean, default=False)
    description = Column(String(255))
    updated_at = Column(DateTime, default=datetime.now, onupdate=datetime.now)

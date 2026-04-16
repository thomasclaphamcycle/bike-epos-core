import React, { useState } from 'react';
import { Button, Collapse, Input, Typography } from 'antd';
import { CopyOutlined, LinkOutlined, ReloadOutlined } from '@ant-design/icons';
import './CustomerNFCCaptureWaitingPanel.css';

const { Title, Text, Paragraph } = Typography;

export default function CustomerNFCCaptureWaitingPanel({
  started,
  expires,
  timeLeft,
  fallbackURL,
  onCopyFallbackLink,
  onOpenFallbackLink,
  onRefresh,
}) {
  const [fallbackOpen, setFallbackOpen] = useState(false);

  return (
    <div className="customer-nfc-waiting-panel">
      <div className="status-pill">Waiting for customer</div>

      <Title level={3} className="main-heading">
        Ask customer to tap now
      </Title>

      <Paragraph className="intro-copy">
        Their phone should open the secure capture page for this basket.
      </Paragraph>

      <div className="timing-row">
        <div className="timing-meta">
          <Text>
            Started: <strong>{started}</strong>
          </Text>
          <Text>
            Expires: <strong>{expires}</strong>
          </Text>
          <Text>
            Time left: <strong>{timeLeft}</strong>
          </Text>
        </div>
        <Button
          type="primary"
          icon={<ReloadOutlined />}
          onClick={onRefresh}
          className="refresh-button"
        >
          Refresh
        </Button>
      </div>

      <Collapse
        activeKey={fallbackOpen ? ['1'] : []}
        onChange={() => setFallbackOpen(!fallbackOpen)}
        className="fallback-collapse"
      >
        <Collapse.Panel header="Fallback link" key="1" className="fallback-panel">
          <Paragraph className="fallback-helper">
            Use only if tap does not open the page.
          </Paragraph>

          <label htmlFor="fallback-url" className="fallback-label">
            Fallback URL
          </label>
          <Input
            id="fallback-url"
            value={fallbackURL}
            readOnly
            className="fallback-url-input"
          />

          <div className="fallback-actions">
            <Button onClick={onCopyFallbackLink} icon={<CopyOutlined />}>
              Copy link
            </Button>
            <Button onClick={onOpenFallbackLink} icon={<LinkOutlined />} type="link">
              Open
            </Button>
          </div>

          <Text type="warning" className="fallback-warning">
            New tap requests expire this link.
          </Text>
        </Collapse.Panel>
      </Collapse>
    </div>
  );
}

/* CustomerNFCCaptureWaitingPanel.css */

.customer-nfc-waiting-panel {
  padding: 16px 20px;
}

.status-pill {
  display: inline-block;
  background-color: #e6f7ff;
  color: #1890ff;
  padding: 2px 8px;
  border-radius: 12px;
  font-weight: 600;
  font-size: 0.85rem;
  margin-bottom: 8px;
}

.main-heading {
  margin-bottom: 8px;
}

.intro-copy {
  margin-bottom: 12px;
  line-height: 1.3;
}

.timing-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 12px;
}

.timing-meta {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.timing-meta > span {
  white-space: nowrap;
}

.refresh-button {
  padding: 4px 12px;
  min-height: 30px;
  font-size: 0.875rem;
}

.fallback-collapse {
  margin-top: 8px;
}

.fallback-panel {
  padding: 0;
  border: none;
}

.fallback-helper {
  margin-bottom: 8px;
  font-size: 0.9rem;
}

.fallback-label {
  display: block;
  margin-bottom: 4px;
  font-weight: 600;
}

.fallback-url-input {
  height: 30px;
  padding: 4px 8px;
  font-size: 0.9rem;
  margin-bottom: 8px;
}

.fallback-actions {
  display: inline-flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.fallback-warning {
  font-size: 0.85rem;
  color: #fa8c16;
  display: block;
  margin-top: 4px;
}

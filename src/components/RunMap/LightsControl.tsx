import styles from './style.module.css';

interface ILightsProps {
  setLights: (_lights: boolean) => void;
  lights: boolean;
}

const LightsControl = ({ setLights, lights }: ILightsProps) => {
  return (
    <div className={'mapboxgl-ctrl mapboxgl-ctrl-group ' + styles.lights}>
      <button
        type="button"
        className={`${lights ? styles.lightsOn : styles.lightsOff}`}
        onClick={() => setLights(!lights)}
        aria-label={lights ? '隐藏地图底图' : '显示地图底图'}
        aria-pressed={lights}
        title={lights ? '隐藏地图底图' : '显示地图底图'}
      >
        <span className="mapboxgl-ctrl-icon" aria-hidden="true"></span>
      </button>
    </div>
  );
};

export default LightsControl;

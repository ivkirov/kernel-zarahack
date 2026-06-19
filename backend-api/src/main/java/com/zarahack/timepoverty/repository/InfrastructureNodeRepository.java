package com.zarahack.timepoverty.repository;

import com.zarahack.timepoverty.entity.InfrastructureNode;
import org.springframework.data.jpa.repository.JpaRepository;
import java.util.List;

public interface InfrastructureNodeRepository extends JpaRepository<InfrastructureNode, Long> {
    List<InfrastructureNode> findByDistrict(String district);
    List<InfrastructureNode> findByDistrictAndServiceTypeIn(String district, List<String> serviceTypes);
}
